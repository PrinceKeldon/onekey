from datetime import datetime
from typing import Literal, Optional
from pydantic import BaseModel


class IdentityCheckRequest(BaseModel):
    identity_type: Literal["serial", "barcode"]
    identity_value: str


class IdentityCheckResponse(BaseModel):
    available: bool
    existing_onekey_code: Optional[str] = None  # set if already claimed, so caller can link to it


class ClaimRequest(BaseModel):
    name: str
    owner_contact: str
    owner_display_name: str
    identity_type: Literal["serial", "barcode", "qr_tag"]
    identity_value: Optional[str] = None  # required for serial/barcode; auto-generated for qr_tag


class PhotoWarning(BaseModel):
    similar_thing_code: str
    distance: int


class ClaimResponse(BaseModel):
    onekey_code: str
    identity_type: str
    identity_value: str
    photo_warning: Optional[PhotoWarning] = None


class HistoryEventOut(BaseModel):
    type: str
    detail: Optional[str] = None
    created_at: datetime

    class Config:
        from_attributes = True


class DocumentOut(BaseModel):
    label: str
    url: str
    uploaded_at: datetime

    class Config:
        from_attributes = True


class PhotoOut(BaseModel):
    url: str
    is_primary: bool
    created_at: datetime

    class Config:
        from_attributes = True


class ThingPublic(BaseModel):
    onekey_code: str
    name: str
    status: str
    owner_display_name: str
    created_at: datetime
    history: list[HistoryEventOut]
    documents: list[DocumentOut]
    photos: list[PhotoOut]

    class Config:
        from_attributes = True
