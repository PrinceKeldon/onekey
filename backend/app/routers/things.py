from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, Form, Response
import uuid
import mimetypes
from urllib.parse import urlparse

from sqlalchemy.orm import Session
from sqlalchemy.exc import IntegrityError

from app.database import get_db, settings, get_storage_client
from app import models, schemas
from app.utils.idgen import generate_onekey_code, generate_qr_tag_value
from app.utils.phash import compute_phash, hamming_distance

router = APIRouter(prefix="/things", tags=["things"])


def _normalize_contact(contact: str) -> str:
    """Contact is the proof-of-ownership anchor (documents, transfer). Case
    and incidental whitespace must never make the same person look like two
    different owners, or a legitimate owner could fail their own ownership
    check."""
    return contact.strip().lower()


def _get_or_create_user(db: Session, contact: str, display_name: str) -> models.User:
    contact = _normalize_contact(contact)
    user = db.query(models.User).filter(models.User.contact == contact).first()
    if user:
        return user
    user = models.User(contact=contact, display_name=display_name)
    db.add(user)
    db.flush()
    return user


def _normalize_identity(identity_type: str, identity_value: str | None) -> str | None:
    if identity_type in ("serial", "barcode") and identity_value:
        return identity_value.strip().upper()
    return identity_value


@router.get("/generate-tag")
def generate_tag(db: Session = Depends(get_db)):
    for _ in range(10):
        code = generate_onekey_code()
        if not db.query(models.Thing).filter(models.Thing.onekey_code == code).first():
            return {"code": code, "url_path": f"/t/{code}"}
    raise HTTPException(500, "could not generate a unique code, try again")


@router.post("/check-identity", response_model=schemas.IdentityCheckResponse)
def check_identity(payload: schemas.IdentityCheckRequest, db: Session = Depends(get_db)):
    identity_value = _normalize_identity(payload.identity_type, payload.identity_value)
    existing = (
        db.query(models.Thing)
        .filter(
            models.Thing.identity_type == payload.identity_type,
            models.Thing.identity_value == identity_value,
        )
        .first()
    )
    if existing:
        return schemas.IdentityCheckResponse(
            available=False,
            existing_onekey_code=existing.onekey_code,
        )
    return schemas.IdentityCheckResponse(available=True)


@router.post("/claim", response_model=schemas.ClaimResponse)
def claim_thing(
    name: str = Form(...),
    owner_contact: str = Form(...),
    owner_display_name: str = Form(...),
    identity_type: str = Form(...),
    identity_value: str = Form(None),
    tag_code: str = Form(None),
    photo: UploadFile = File(...),
    db: Session = Depends(get_db),
):
    if identity_type not in ("serial", "barcode", "qr_tag"):
        raise HTTPException(400, "invalid identity_type")

    identity_value = _normalize_identity(identity_type, identity_value)

    if identity_type in ("serial", "barcode") and not identity_value:
        raise HTTPException(400, "identity_value is required for serial/barcode claims")

    if identity_type == "qr_tag":
        final_identity_value = tag_code or generate_qr_tag_value()
    else:
        final_identity_value = identity_value

    owner = _get_or_create_user(db, owner_contact, owner_display_name)

    image_bytes = photo.file.read()
    phash_value = compute_phash(image_bytes)

    onekey_code = tag_code if (identity_type == "qr_tag" and tag_code) else generate_onekey_code()
    storage_path = f"things/{onekey_code}/photos/{uuid.uuid4()}_{photo.filename or 'upload'}"
    try:
        supabase = get_storage_client()
        file_options = {
            "content-type": photo.content_type or "application/octet-stream",
            "upsert": "false",
        }
        supabase.storage.from_(settings.storage_bucket).upload(
            storage_path,
            image_bytes,
            file_options=file_options,
        )
        photo_url = supabase.storage.from_(settings.storage_bucket).get_public_url(storage_path)
    except Exception as exc:
        db.rollback()
        raise HTTPException(502, f"Photo storage upload failed: {exc}") from exc

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
    db.commit()

    return schemas.ClaimResponse(
        onekey_code=thing.onekey_code,
        identity_type=thing.identity_type,
        identity_value=thing.identity_value,
        photo_warning=warning,
    )


@router.get("/{onekey_code}/photo")
def get_primary_photo(onekey_code: str, db: Session = Depends(get_db)):
    thing = db.query(models.Thing).filter(models.Thing.onekey_code == onekey_code).first()
    if not thing:
        raise HTTPException(404, "Thing not found")

    photo = next((p for p in thing.photos if p.is_primary), None) or (thing.photos[0] if thing.photos else None)
    if not photo:
        raise HTTPException(404, "Photo not found")

    parsed = urlparse(photo.url)
    marker = "/storage/v1/object/public/" + settings.storage_bucket + "/"
    if marker not in parsed.path:
        raise HTTPException(404, "Photo storage path could not be resolved")
    storage_path = parsed.path.split(marker, 1)[1]

    try:
        supabase = get_storage_client()
        image_bytes = supabase.storage.from_(settings.storage_bucket).download(storage_path)
    except Exception as exc:
        raise HTTPException(502, f"Photo download failed: {exc}") from exc

    media_type = mimetypes.guess_type(storage_path)[0] or "application/octet-stream"
    return Response(content=image_bytes, media_type=media_type)


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
        identity_type=thing.identity_type,
        identity_value=thing.identity_value,
        history=[schemas.HistoryEventOut.model_validate(h) for h in thing.history],
        documents=[schemas.DocumentOut.model_validate(d) for d in thing.documents],
        photos=[schemas.PhotoOut.model_validate(p) for p in thing.photos],
    )


@router.post("/{onekey_code}/documents", response_model=schemas.DocumentOut)
def add_document(
    onekey_code: str,
    label: str = Form(...),
    owner_contact: str = Form(...),
    body: str = Form(None),
    file: UploadFile = File(None),
    db: Session = Depends(get_db),
):
    thing = db.query(models.Thing).filter(models.Thing.onekey_code == onekey_code).first()
    if not thing:
        raise HTTPException(404, "Thing not found")

    # Proof-of-ownership check: only the current owner can add a document to
    # this record. Same contact-matching pattern as the rest of the model —
    # no separate auth system, the contact given at claim time IS the key.
    if _normalize_contact(owner_contact) != thing.owner.contact:
        raise HTTPException(403, "Only the current owner can add documents to this record.")

    note = body.strip() if body else None
    if not file and not note:
        raise HTTPException(400, "Provide a file, a written note, or both.")

    url = None
    if file:
        file_bytes = file.file.read()
        storage_path = f"things/{onekey_code}/documents/{uuid.uuid4()}_{file.filename or 'upload'}"
        try:
            supabase = get_storage_client()
            file_options = {
                "content-type": file.content_type or "application/octet-stream",
                "upsert": "false",
            }
            supabase.storage.from_(settings.storage_bucket).upload(
                storage_path,
                file_bytes,
                file_options=file_options,
            )
            url = supabase.storage.from_(settings.storage_bucket).get_public_url(storage_path)
        except Exception as exc:
            db.rollback()
            raise HTTPException(502, f"Document storage upload failed: {exc}") from exc

    # uploaded_at is never taken from the client — it's the column default,
    # set by the database at insert time. That's what makes the ledger's
    # dates mean something rather than just look like they do.
    doc = models.Document(thing_id=thing.id, url=url, body=note, label=label)
    db.add(doc)
    db.add(models.HistoryEvent(
        thing_id=thing.id, type="document_added", actor_id=thing.owner_id, detail=label
    ))
    db.commit()
    db.refresh(doc)
    return doc


@router.post("/{onekey_code}/transfer", response_model=schemas.TransferResponse)
def transfer_ownership(
    onekey_code: str,
    current_owner_contact: str = Form(...),
    new_owner_contact: str = Form(...),
    new_owner_display_name: str = Form(...),
    db: Session = Depends(get_db),
):
    thing = db.query(models.Thing).filter(models.Thing.onekey_code == onekey_code).first()
    if not thing:
        raise HTTPException(404, "Thing not found")

    # Proof-of-ownership: same contact-matching pattern as add_document.
    # This is the ONLY thing standing between "I own this" and "I typed a
    # code" — get it wrong and the whole model is just an honor system.
    if _normalize_contact(current_owner_contact) != thing.owner.contact:
        raise HTTPException(403, "Only the current owner can transfer this record.")

    normalized_new_contact = _normalize_contact(new_owner_contact)
    if normalized_new_contact == thing.owner.contact:
        raise HTTPException(400, "This contact already owns the record.")

    previous_owner = thing.owner
    new_owner = _get_or_create_user(db, new_owner_contact, new_owner_display_name)

    thing.owner_id = new_owner.id
    # status is deliberately left as-is (see comment on the Thing model docs
    # / product notes) — ownership is derived from history, not a status
    # flag, so "transferred" as a persistent status isn't set here.
    db.add(models.HistoryEvent(
        thing_id=thing.id,
        type="ownership_transferred",
        actor_id=previous_owner.id,
        detail=f"{previous_owner.display_name} -> {new_owner.display_name}",
    ))
    db.commit()

    return schemas.TransferResponse(
        onekey_code=thing.onekey_code,
        previous_owner_display_name=previous_owner.display_name,
        new_owner_display_name=new_owner.display_name,
    )
