import os
import uuid

from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, Form
from sqlalchemy.orm import Session
from sqlalchemy.exc import IntegrityError

from app.database import get_db, settings
from app import models, schemas
from app.utils.idgen import generate_onekey_code, generate_qr_tag_value
from app.utils.phash import compute_phash, hamming_distance

router = APIRouter(prefix="/things", tags=["things"])

os.makedirs(settings.local_media_dir, exist_ok=True)


def _get_or_create_user(db: Session, contact: str, display_name: str) -> models.User:
    user = db.query(models.User).filter(models.User.contact == contact).first()
    if user:
        return user
    user = models.User(contact=contact, display_name=display_name)
    db.add(user)
    db.flush()
    return user


@router.get("/generate-tag")
def generate_tag(db: Session = Depends(get_db)):
    """Mint a fresh, guaranteed-unclaimed code for printing a new physical
    QR label ahead of time (batch printing use case). The code isn't bound
    to anything until someone actually claims it via /claim with tag_code set."""
    for _ in range(10):
        code = generate_onekey_code()
        if not db.query(models.Thing).filter(models.Thing.onekey_code == code).first():
            return {"code": code, "url_path": f"/t/{code}"}
    raise HTTPException(500, "could not generate a unique code, try again")


@router.post("/check-identity", response_model=schemas.IdentityCheckResponse)
def check_identity(payload: schemas.IdentityCheckRequest, db: Session = Depends(get_db)):
    """Path A pre-check: does this serial/barcode already have a ONEKEY record?
    Called before showing the claim form, so a user trying to claim an
    already-registered item is redirected to the existing record instead of
    hitting a raw DB error."""
    existing = (
        db.query(models.Thing)
        .filter(models.Thing.identity_value == payload.identity_value)
        .first()
    )
    if existing:
        return schemas.IdentityCheckResponse(available=False, existing_onekey_code=existing.onekey_code)
    return schemas.IdentityCheckResponse(available=True)


@router.post("/claim", response_model=schemas.ClaimResponse)
def claim_thing(
    name: str = Form(...),
    owner_contact: str = Form(...),
    owner_display_name: str = Form(...),
    identity_type: str = Form(...),
    identity_value: str = Form(None),
    tag_code: str = Form(None),  # set when claiming a pre-printed, already-scanned QR (e.g. from /t/{code})
    photo: UploadFile = File(...),
    db: Session = Depends(get_db),
):
    if identity_type not in ("serial", "barcode", "qr_tag"):
        raise HTTPException(400, "invalid identity_type")

    if identity_type in ("serial", "barcode") and not identity_value:
        raise HTTPException(400, "identity_value is required for serial/barcode claims")

    if identity_type == "qr_tag":
        # The physical sticker's own printed code is the only identity anchor
        # this path has, so it doubles as both the public onekey_code and the
        # unique identity_value — reusing it (not minting a second string) is
        # what makes "swap the sticker" detectable rather than invisible.
        final_identity_value = tag_code or generate_qr_tag_value()
    else:
        final_identity_value = identity_value

    owner = _get_or_create_user(db, owner_contact, owner_display_name)

    # --- Photo: save + perceptual hash + similarity check (soft warning only) ---
    image_bytes = photo.file.read()
    phash_value = compute_phash(image_bytes)

    filename = f"{uuid.uuid4()}_{photo.filename}"
    filepath = os.path.join(settings.local_media_dir, filename)
    with open(filepath, "wb") as f:
        f.write(image_bytes)
    photo_url = f"/media/{filename}"

    warning = None
    existing_photos = db.query(models.Photo).all()
    best_distance = None
    best_match_code = None
    for p in existing_photos:
        d = hamming_distance(phash_value, p.phash)
        if d is not None and (best_distance is None or d < best_distance):
            best_distance = d
            best_match_code = p.thing.onekey_code if p.thing else None

    if best_distance is not None and best_distance <= settings.phash_warning_threshold and best_match_code:
        warning = schemas.PhotoWarning(similar_thing_code=best_match_code, distance=best_distance)

    # --- Create the Thing. identity_value's DB-level UNIQUE constraint is the
    # actual fraud-prevention mechanism: if two claims race on the same
    # serial, one of them fails here, not silently later. ---
    onekey_code = tag_code if (identity_type == "qr_tag" and tag_code) else generate_onekey_code()

    thing = models.Thing(
        onekey_code=onekey_code,
        name=name,
        owner_id=owner.id,
        identity_type=identity_type,
        identity_value=final_identity_value,
    )
    db.add(thing)
    try:
        db.flush()
    except IntegrityError:
        db.rollback()
        raise HTTPException(409, "This identity value is already claimed by another ONEKEY record.")

    db.add(models.Photo(thing_id=thing.id, url=photo_url, is_primary=True, phash=phash_value))
    db.add(models.HistoryEvent(thing_id=thing.id, type="created", actor_id=owner.id))
    db.add(models.HistoryEvent(thing_id=thing.id, type="claimed", actor_id=owner.id))

    db.commit()

    return schemas.ClaimResponse(
        onekey_code=thing.onekey_code,
        identity_type=thing.identity_type,
        identity_value=thing.identity_value,
        photo_warning=warning,
    )


@router.get("/{onekey_code}", response_model=schemas.ThingPublic)
def get_thing(onekey_code: str, db: Session = Depends(get_db)):
    thing = db.query(models.Thing).filter(models.Thing.onekey_code == onekey_code).first()
    if not thing:
        raise HTTPException(404, "No ONEKEY record found for this code. It may be unclaimed.")

    return schemas.ThingPublic(
        onekey_code=thing.onekey_code,
        name=thing.name,
        status=thing.status,
        owner_display_name=thing.owner.display_name,
        created_at=thing.created_at,
        history=[schemas.HistoryEventOut.model_validate(h) for h in thing.history],
        documents=[schemas.DocumentOut.model_validate(d) for d in thing.documents],
        photos=[schemas.PhotoOut.model_validate(p) for p in thing.photos],
    )


@router.post("/{onekey_code}/documents", response_model=schemas.DocumentOut)
def add_document(
    onekey_code: str,
    label: str = Form(...),
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
):
    thing = db.query(models.Thing).filter(models.Thing.onekey_code == onekey_code).first()
    if not thing:
        raise HTTPException(404, "Thing not found")

    file_bytes = file.file.read()
    filename = f"{uuid.uuid4()}_{file.filename}"
    filepath = os.path.join(settings.local_media_dir, filename)
    with open(filepath, "wb") as f:
        f.write(file_bytes)
    url = f"/media/{filename}"

    doc = models.Document(thing_id=thing.id, url=url, label=label)
    db.add(doc)
    db.add(models.HistoryEvent(thing_id=thing.id, type="document_added", detail=label))
    db.commit()
    db.refresh(doc)
    return doc
