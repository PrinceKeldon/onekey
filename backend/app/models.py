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

    id = Column(UUID(as_uuid=False), primary_key=True, default=gen_uuid)
    thing_id = Column(UUID(as_uuid=False), ForeignKey("things.id", ondelete="CASCADE"), nullable=False)
    url = Column(String, nullable=False)
    label = Column(String, nullable=False)
    uploaded_at = Column(DateTime, default=datetime.utcnow)

    thing = relationship("Thing", back_populates="documents")


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
