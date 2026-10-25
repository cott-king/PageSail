"""Creates the encrypted PDF fixtures (pdf-lib cannot encrypt). Requires: pip install pypdf.

Run from the repository root:  python3 scripts/make-encrypted-fixtures.py
"""
from pypdf import PdfReader, PdfWriter

def encrypt(src, dst, user, owner):
    reader = PdfReader(src)
    writer = PdfWriter()
    for page in reader.pages:
        writer.add_page(page)
    # Owner-only encryption still allows opening without a password but restricts editing.
    writer.encrypt(user_password=user, owner_password=owner, algorithm="AES-128", permissions_flag=0b0100)
    with open(dst, "wb") as f:
        writer.write(f)
    print(dst)

encrypt("tests/fixtures/docA.pdf", "tests/fixtures/encrypted-password.pdf", "secret", "owner-secret")
encrypt("tests/fixtures/docA.pdf", "tests/fixtures/encrypted-owner-only.pdf", "", "owner-secret")
