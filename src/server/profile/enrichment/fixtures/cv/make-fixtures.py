"""Regenerates the CV parser's small test documents (standard library only).

    python src/server/profile/enrichment/fixtures/cv/make-fixtures.py

The person is fictional. office-encrypted.docx is a minimal stand-in for a
password-protected Word file: an OLE compound file holding an EncryptedPackage
stream, which is how Office stores an encrypted .docx.
"""
import hashlib
import os
import struct
import zlib

HERE = os.path.dirname(os.path.abspath(__file__))
CV_LINES = [
    "Ada Example",
    "Research software engineer",
    "Experience",
    "2021-2026 Example University: built data pipelines for climate models in Python and Rust.",
    "2018-2021 Sample Labs: maintained an open-source plotting library.",
    "Skills",
    "Python, Rust, numerical methods, reproducible research",
]


def write(name, data):
    with open(os.path.join(HERE, name), "wb") as f:
        f.write(data)


# ---------- PDF ----------

def pdf_string(text):
    return b"(" + text.encode("latin-1").replace(b"\\", b"\\\\").replace(b"(", b"\\(").replace(b")", b"\\)") + b")"


def text_stream(lines):
    body = b"BT /F1 11 Tf 50 780 Td 14 TL " + b" T* ".join(pdf_string(l) + b" Tj" for l in lines) + b" ET"
    return body


def rc4(key, data):
    s = list(range(256))
    j = 0
    for i in range(256):
        j = (j + s[i] + key[i % len(key)]) % 256
        s[i], s[j] = s[j], s[i]
    out = bytearray()
    i = j = 0
    for byte in data:
        i = (i + 1) % 256
        j = (j + s[i]) % 256
        s[i], s[j] = s[j], s[i]
        out.append(byte ^ s[(s[i] + s[j]) % 256])
    return bytes(out)


PAD = bytes.fromhex("28BF4E5E4E758A4164004E56FFFA01082E2E00B6D0683E802F0CA9FE6453697A")


def build_pdf(pages, password=None, extra_objects=()):
    """pages: list of (content bytes, resources bytes, stream dict extras). Object 1 catalog, 2 pages, 3 font."""
    objects = [None, None, b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>"]
    objects += list(extra_objects)
    kids = []
    streams = set()
    for content, resources, filters in pages:
        objects.append(b"<< /Length %d%s >>\nstream\n" % (len(content), filters) + content + b"\nendstream")
        streams.add(len(objects))
        objects.append(b"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources " + resources
                       + b" /Contents %d 0 R >>" % len(objects))
        kids.append(len(objects))
    objects[0] = b"<< /Type /Catalog /Pages 2 0 R >>"
    objects[1] = b"<< /Type /Pages /Count %d /Kids [%s] >>" % (len(kids), b" ".join(b"%d 0 R" % k for k in kids))
    trailer_extra = b""
    if password:
        file_id = hashlib.md5(b"ada-example-cv").digest()
        p = -44
        owner_key = hashlib.md5((b"owner" + PAD)[:32]).digest()[:5]
        o = rc4(owner_key, (password + PAD)[:32])
        key = hashlib.md5((password + PAD)[:32] + o + struct.pack("<i", p) + file_id).digest()[:5]
        u = rc4(key, PAD)
        for number in streams:  # only the content streams carry text
            raw = objects[number - 1]
            head, rest = raw.split(b"stream\n", 1)
            data = rest[: -len(b"\nendstream")]
            obj_key = hashlib.md5(key + struct.pack("<I", number)[:3] + b"\x00\x00").digest()[:10]
            objects[number - 1] = head + b"stream\n" + rc4(obj_key, data) + b"\nendstream"
        objects.append(b"<< /Filter /Standard /V 1 /R 2 /O <%s> /U <%s> /P %d >>" % (o.hex().encode(), u.hex().encode(), p))
        trailer_extra = b" /Encrypt %d 0 R /ID [<%s> <%s>]" % (len(objects), file_id.hex().encode(), file_id.hex().encode())
    out = bytearray(b"%PDF-1.4\n%\xe2\xe3\xcf\xd3\n")
    offsets = []
    for number, body in enumerate(objects, 1):
        offsets.append(len(out))
        out += b"%d 0 obj\n" % number + body + b"\nendobj\n"
    xref = len(out)
    out += b"xref\n0 %d\n0000000000 65535 f \n" % (len(objects) + 1)
    for offset in offsets:
        out += b"%010d 00000 n \n" % offset
    out += b"trailer\n<< /Size %d /Root 1 0 R%s >>\nstartxref\n%d\n%%%%EOF\n" % (len(objects) + 1, trailer_extra, xref)
    return bytes(out)


OLE = bytes.fromhex("D0CF11E0A1B11AE1")  # OLE compound file signature
FONT = b"<< /Font << /F1 3 0 R >> >>"


def text_page(lines):
    return (text_stream(lines), FONT, b"")


def flate_bomb(size):
    """A FlateDecode stream of `size` spaces, about a thousandth of that compressed."""
    z = zlib.compressobj(9)
    chunk = b" " * (1 << 20)
    data = b"".join(z.compress(chunk) for _ in range(size >> 20)) + z.flush()
    return data


# ---------- ZIP / DOCX ----------

def build_zip(entries, claim=None, shrink=False):
    """entries: (name, data, options) with options: stored, flags, declared (central and local size override).
    claim: the entry count the end record states; shrink: its directory size then covers only those entries."""
    out = bytearray()
    central = bytearray()
    record_ends = []
    for name, data, opts in entries:
        raw_name = name.encode()
        method = 0 if opts.get("stored") else 8
        body = data if method == 0 else zlib.compress(data, 9)[2:-4]
        size = opts.get("declared", len(data))
        crc = zlib.crc32(data)
        flags = opts.get("flags", 0)
        offset = len(out)
        out += struct.pack("<IHHHHHIIIHH", 0x04034B50, 20, flags, method, 0, 0x21, crc, len(body), size, len(raw_name), 0)
        out += raw_name + body
        central += struct.pack("<IHHHHHHIIIHHHHHII", 0x02014B50, 20, 20, flags, method, 0, 0x21, crc, len(body), size,
                               len(raw_name), 0, 0, 0, 0, 0, offset) + raw_name
        record_ends.append(len(central))
    count = len(entries) if claim is None else claim
    size = record_ends[count - 1] if shrink else len(central)
    out_end = len(out)
    out += central
    out += struct.pack("<IHHHHIIH", 0x06054B50, 0, 0, count, count, size, out_end, 0)
    return bytes(out)


CONTENT_TYPES = (b'<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
                 b'<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
                 b'<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'
                 b'<Default Extension="xml" ContentType="application/xml"/>'
                 b'<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>'
                 b"</Types>")
RELS = (b'<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        b'<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
        b'<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>'
        b"</Relationships>")


def document_xml(paragraphs):
    body = b"".join(b"<w:p><w:r><w:t xml:space=\"preserve\">" + p.encode().replace(b"&", b"&amp;").replace(b"<", b"&lt;")
                    + b"</w:t></w:r></w:p>" for p in paragraphs)
    return (b'<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
            b'<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>'
            + body + b"</w:body></w:document>")


def docx(document, extra=(), claim=None, shrink=False, **doc_opts):
    return build_zip([("[Content_Types].xml", CONTENT_TYPES, {}), ("_rels/.rels", RELS, {}),
                      ("word/document.xml", document, doc_opts), *extra], claim, shrink)


def main():
    write("text.pdf", build_pdf([text_page(CV_LINES)]))
    write("many-pages.pdf", build_pdf([text_page([f"Page {n} of the publication list"]) for n in range(1, 23)]))
    line = "Led a reproducible-research workshop series for postgraduate students and staff. "
    write("long.pdf", build_pdf([text_page([f"{p}.{n} {line}" for n in range(1, 26)]) for p in range(1, 21)]))
    image = b"<< /Type /XObject /Subtype /Image /Width 8 /Height 8 /ColorSpace /DeviceGray /BitsPerComponent 8 /Length 64 >>\nstream\n" + bytes(range(0, 256, 4)) + b"\nendstream"
    write("scanned.pdf", build_pdf([(b"q 400 0 0 500 100 150 cm /Im1 Do Q", b"<< /XObject << /Im1 4 0 R >> >>", b"")], extra_objects=[image]))
    write("encrypted.pdf", build_pdf([text_page(CV_LINES)], password=b"secret"))
    write("malformed.pdf", b"%PDF-1.7\n" + bytes(range(256)) * 8)
    bomb = flate_bomb(512 << 20)
    write("bomb.pdf", build_pdf([(bomb, FONT, b" /Filter /FlateDecode")]))

    write("text.docx", docx(document_xml(CV_LINES)))
    write("messy.docx", docx(document_xml(["Ada\u200bExample", "co\u00adoperative   research\tlead", "", "", "", "  Skills  ", "Python\ufeff" * 3])))
    write("image-only.docx", docx(document_xml([])))
    write("large.docx", docx(document_xml([f"Paragraph {n} of a very long appendix." for n in range(150_000)])))
    write("bomb.docx", docx(document_xml(["x" * (21 << 20)])))
    write("lying.docx", docx(document_xml(["y" * (5 << 20)]), declared=4096))
    write("encrypted-entry.docx", docx(document_xml(CV_LINES), flags=1))
    write("many-entries.docx", docx(document_xml(CV_LINES), extra=[(f"customXml/item{n}.xml", b"<a/>", {"stored": True}) for n in range(1000)]))
    # The end record understates the entry count (and, shrunk, the directory size), hiding entries JSZip
    # still lists but Mammoth never reads: 500 parts (past the entry cap) and one lying about its size.
    hidden = [(f"customXml/item{n}.xml", b"<a/>", {"stored": True}) for n in range(500)] + [("customXml/big.xml", b"z" * (1 << 20), {"declared": 10})]
    write("miscounted.docx", docx(document_xml(CV_LINES), extra=hidden, claim=3))
    write("miscounted-size.docx", docx(document_xml(CV_LINES), extra=hidden, claim=3, shrink=True))
    write("not-docx.zip", build_zip([("mimetype", b"application/vnd.oasis.opendocument.text", {"stored": True}),
                                     ("content.xml", b"<office:document-content/>", {})]))
    write("legacy.doc", OLE + bytes(504) + "WordDocument".encode("utf-16-le") + bytes(1000))
    write("office-encrypted.docx", OLE + bytes(504) + "EncryptionInfo".encode("utf-16-le")
          + bytes(50) + "EncryptedPackage".encode("utf-16-le") + bytes(1000))
    write("image.png", b"\x89PNG\r\n\x1a\n" + bytes(100))


if __name__ == "__main__":
    main()
