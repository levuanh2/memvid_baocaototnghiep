// V9.3 P3a (docs/StudyMap-V9.3/05 "Thêm tài liệu"): check in order — unsupported extension,
// then over the size limit; a file exactly at the limit is accepted. The limit is the server's
// (BE MAX_UPLOAD_MB, default 100), not the prototype's 25 MiB.
import { describe, expect, it } from "vitest";
import { GIOI_HAN_TAI_LEN, kiemTraTep } from "./taiLenTep";

const ACCEPT = ".docx,.pdf,.txt";
const tep = (name, size = 1) => ({ name, size });

describe("kiemTraTep", () => {
  it("uses the server default of 100 MiB", () => {
    expect(GIOI_HAN_TAI_LEN).toBe(100 * 1024 * 1024);
  });

  it("accepts a supported file, extension in any case", () => {
    expect(kiemTraTep(tep("Bài 1.pdf"), ACCEPT)).toBeNull();
    expect(kiemTraTep(tep("GHI-CHU.TXT"), ACCEPT)).toBeNull();
  });

  it("names the unsupported extension before looking at the size", () => {
    const loi = kiemTraTep(tep("setup.exe", GIOI_HAN_TAI_LEN + 1), ACCEPT);
    expect(loi).toMatch(/\.exe/);
    expect(loi).not.toMatch(/MB/);
  });

  it("rejects a file without an extension", () => {
    expect(kiemTraTep(tep("README"), ACCEPT)).toMatch(/định dạng/);
  });

  it("accepts exactly the limit and rejects one byte more", () => {
    expect(kiemTraTep(tep("a.pdf", GIOI_HAN_TAI_LEN), ACCEPT)).toBeNull();
    expect(kiemTraTep(tep("a.pdf", GIOI_HAN_TAI_LEN + 1), ACCEPT)).toMatch(/100 MB/);
  });
});
