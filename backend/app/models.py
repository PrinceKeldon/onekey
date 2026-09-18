import uuid
from datetime import datetime

from sqlalchemy import (
    Column, String, Boolean, ForeignKey, DateTime, Text, CheckConstraint
)
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import relationship

from app.database import Base


def gen_uuid():
    return str(uuid.uuid4())


class User(Base):
    __tablename__ = "users"

    id = Column(UUID(as_uuid=False), primary_key=True, default=gen_uuid)
    display_name = Column(String, nullable=False)
    contact = Column(String, nullable=False, unique=True)
    created_at = Column(DateTime, default=datetime.utcnow)

    things = relationship("Thing", back_populates="owner")


class Thing(Base):
    __tablename__ = "things"
    __table_args__ = (
        CheckConstraint("status in ('active','transferred','archived')", name="ck_thing_status"),
        CheckConstraint("identity_type in ('serial','barcode','qr_tag')", name="ck_identity_type"),
    )

    id = Column(UUID(as_uuid=False), primary_key=True, default=gen_uuid)
    onekey_code = Column(String, nullable=False, unique=True)
    name = Column(String, nullable=False)
    owner_id = Column(UUID(as_uuid=False), ForeignKey("users.id"), nullable=False)
    status = Column(String, nullable=False, default="active")

    identity_type = Column(String, nullable=False)
    # THE CORE FRAUD-PREVENTION CONSTRAINT — see supabase_schema.sql comment.
    identity_value = Column(String, nullable=False, unique=True)

    created_at = Column(DateTime, default=datetime.utcnow)

    owner = relationship("User", back_populates="things")
    photos = relationship("Photo", back_populates="thing", cascade="all, delete-orphan")
    documents = relationship("Document", back_populates="thing", cascade="all, delete-orphan")
    history = relationship("HistoryEvent", back_populates="thing", cascade="all, delete-orphan")


class Photo(Base):
    __tablename__ = "photos"

    id = Column(UUID(as_uuid=False), primary_key=True, default=gen_uuid)
    thing_id = Column(UUID(as_uuid=False), ForeignKey("things.id", ondelete="CASCADE"), nullable=False)
    url = Column(String, nullable=False)
    is_primary = Column(Boolean, default=False)
    phash = Column(String, nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow)

    thing = relationship("Thing", back_populates="photos")


class Document(Base):
    __tablename__ = "documents"
    __table_args__ = (
        # A ledger entry has to carry something — a file, a written note, or
        # both. Neither present means nothing was actually recorded.
        CheckConstraint("url is not null or body is not null", name="ck_document_has_content"),
    )

    id = Column(UUID(as_uuid=False), primary_key=True, default=gen_uuid)
    thing_id = Column(UUID(as_uuid=False), ForeignKey("things.id", ondelete="CASCADE"), nullable=False)
    url = Column(String, nullable=True)   # Supabase Storage URL — null for a note-only entry
    body = Column(Text, nullable=True)    # written note — null for a file-only entry
    label = Column(String, nullable=False)
    uploaded_at = Column(DateTime, default=datetime.utcnow)  # server-set only, never client-supplied

    thing = relationship("Thing", back_populates="documents")


class OwnershipTransfer(Base):
    __tablename__ = "ownership_transfers"
    __table_args__ = (
        CheckConstraint(
            "status in ('pending','completed','cancelled','expired')",
            name="ck_transfer_status",
        ),
    )

    id = Column(UUID(as_uuid=False), primary_key=True, default=gen_uuid)
    thing_id = Column(UUID(as_uuid=False), ForeignKey("things.id", ondelete="CASCADE"), nullable=False)
    current_owner_id = Column(UUID(as_uuid=False), ForeignKey("users.id"), nullable=False)
    new_owner_id = Column(UUID(as_uuid=False), ForeignKey("users.id"), nullable=False)
    current_owner_confirmed_at = Column(DateTime, nullable=True)
    new_owner_confirmed_at = Column(DateTime, nullable=True)
    status = Column(String, nullable=False, default="pending")
    created_at = Column(DateTime, default=datetime.utcnow)
    completed_at = Column(DateTime, nullable=True)

    thing = relationship("Thing")
    current_owner = relationship("User", foreign_keys=[current_owner_id])
    new_owner = relationship("User", foreign_keys=[new_owner_id])


class HistoryEvent(Base):
    __tablename__ = "history_events"
    __table_args__ = (
        CheckConstraint(
            "type in ('created','claimed','document_added','photo_added','ownership_transferred')",
            name="ck_history_type",
        ),
    )

    id = Column(UUID(as_uuid=False), primary_key=True, default=gen_uuid)
    thing_id = Column(UUID(as_uuid=False), ForeignKey("things.id", ondelete="CASCADE"), nullable=False)
    type = Column(String, nullable=False)
    actor_id = Column(UUID(as_uuid=False), ForeignKey("users.id"), nullable=True)
    detail = Column(Text, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)

    thing = relationship("Thing", back_populates="history")
