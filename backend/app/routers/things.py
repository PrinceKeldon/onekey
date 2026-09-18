import uuid

from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, Form, Header
from sqlalchemy.orm import Session
from sqlalchemy.exc import IntegrityError

from app.database import get_db, get_storage_client, get_auth_client, settings
from app import models, schemas
from app.utils.idgen import generate_onekey_code, generate_qr_tag_value
from app.utils.phash import compute_phash, hamming_distance

router = APIRouter(prefix="/things", tags=["things"])


def get_authenticated_email(authorization: str | None = Header(None)) -> str:
    """Verifies a Supabase session token and returns the signed-in user's
    email. Used to gate ownership transfer — the one action in this app with
    real fraud/financial weight, per the auth decision to leave claiming and
    document uploads on the lighter contact-match model for now."""
    if not authorization or not authorization.lower().startswith("bearer "):
        raise HTTPException(401, "Sign in required to do this. Missing Authorization header.")
    token = authorization.split(" ", 1)[1].strip()
    try:
        user_response = get_auth_client().auth.get_user(token)
    except Exception:
        raise HTTPException(401, "Your session has expired or is invalid. Please sign in again.")

    user = getattr(user_response, "user", None)
    email = getattr(user, "email", None) if user else None
    if not email:
        raise HTTPException(401, "Your session has expired or is invalid. Please sign in again.")
    return email.strip().lower()


def _upload_to_storage(file_bytes: bytes, storage_path: str, content_type: str | None) -> str:
    storage = get_storage_client().storage.from_(settings.storage_bucket)
    storage.upload(
        storage_path,
        file_bytes,
        file_options={"content-type": content_type or "application/octet-stream", "upsert": False},
    )
    return storage.get_public_url(storage_path)


def _get_or_create_user(db: Session, contact: str, display_name: str) -> models.User:
    user = db.query(models.User).filter(models.User.contact == contact).first()
    if user:
        return user
    user = models.User(contact=contact, display_name=display_name)
    db.add(user)
    db.flush()
    return user


def _serialize_thing(thing: models.Thing) -> schemas.ThingPublic:
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


@router.get("/generate-tag")
def generate_tag(db: Session = Depends(get_db)):
    for _ in range(10):
        code = generate_onekey_code()
        if not db.query(models.Thing).filter(models.Thing.onekey_code == code).first():
            return {"code": code, "url_path": f"/t/{code}"}
    raise HTTPException(500, "could not generate a unique code, try again")


@router.post("/check-identity", response_model=schemas.IdentityCheckResponse)
def check_identity(payload: schemas.IdentityCheckRequest, db: Session = Depends(get_db)):
    # ONEKEY treats device serials/barcodes as uppercase identifiers.
    identity_value = payload.identity_value.strip().upper()
    existing = db.query(models.Thing).filter(models.Thing.identity_value == identity_value).first()
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
    tag_code: str = Form(None),
    photo: UploadFile = File(...),
    db: Session = Depends(get_db),
):
    if identity_type not in ("serial", "barcode", "qr_tag"):
        raise HTTPException(400, "invalid identity_type")
    if identity_type in ("serial", "barcode") and not identity_value:
        raise HTTPException(400, "identity_value is required for serial/barcode claims")

    if identity_type in ("serial", "barcode"):
        final_identity_value = identity_value.strip().upper()
    else:
        final_identity_value = tag_code or generate_qr_tag_value()

    owner = _get_or_create_user(db, owner_contact, owner_display_name)

    image_bytes = photo.file.read()
    phash_value = compute_phash(image_bytes)

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

    onekey_code = tag_code if (identity_type == "qr_tag" and tag_code) else generate_onekey_code()
    thing = models.Thing(
        onekey_code=onekey_code, name=name, owner_id=owner.id,
        identity_type=identity_type, identity_value=final_identity_value,
    )
    db.add(thing)
    try:
        db.flush()
    except IntegrityError:
        db.rollback()
        raise HTTPException(409, "This identity value is already claimed by another ONEKEY record.")

    filename = f"{uuid.uuid4()}_{photo.filename or 'photo'}"
    storage_path = f"things/{onekey_code}/photos/{filename}"
    try:
        photo_url = _upload_to_storage(image_bytes, storage_path, photo.content_type)
    except Exception as exc:
        db.rollback()
        raise HTTPException(502, f"Could not store photo: {exc}")

    db.add(models.Photo(thing_id=thing.id, url=photo_url, is_primary=True, phash=phash_value))
    db.add(models.HistoryEvent(thing_id=thing.id, type="created", actor_id=owner.id))
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
    return _serialize_thing(thing)


@router.post("/{onekey_code}/transfer", response_model=schemas.ThingPublic)
def transfer_thing(
    onekey_code: str,
    payload: schemas.TransferRequest,
    authenticated_email: str = Depends(get_authenticated_email),
    db: Session = Depends(get_db),
):
    thing = db.query(models.Thing).filter(models.Thing.onekey_code == onekey_code).first()
    if not thing:
        raise HTTPException(404, "Thing not found")

    # Real check now: the caller must be signed in (verified Supabase
    # session) as the exact email the Thing's current owner registered with.
    # Note this only works when the owner's contact on file is an email —
    # if a Thing was claimed with a phone number as contact, its owner
    # currently has no way to pass this check. Magic-link auth here is
    # email-only; SMS/phone OTP is a separate provider setup, out of scope
    # for this pass.
    if thing.owner.contact.strip().lower() != authenticated_email:
        raise HTTPException(
            403,
            f"You're signed in as {authenticated_email}, but this ONEKEY is registered to a different "
            "contact. Only the current owner can transfer it.",
        )

    new_owner = _get_or_create_user(db, payload.new_owner_contact, payload.new_owner_display_name)
    if new_owner.id == thing.owner_id:
        raise HTTPException(400, "This person already owns this ONEKEY.")

    old_owner_name = thing.owner.display_name
    thing.owner_id = new_owner.id
    db.add(models.HistoryEvent(
        thing_id=thing.id,
        type="ownership_transferred",
        actor_id=new_owner.id,
        detail=f"{old_owner_name} → {new_owner.display_name}",
    ))
    db.commit()
    db.refresh(thing)
    return _serialize_thing(thing)


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
    if thing.owner.contact.strip().lower() != owner_contact.strip().lower():
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
    db.add(models.HistoryEvent(thing_id=thing.id, type="document_added", detail=label))
    db.commit()
    db.refresh(doc)
    return doc
