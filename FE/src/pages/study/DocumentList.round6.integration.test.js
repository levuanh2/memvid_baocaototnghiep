import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = readFileSync(new URL("./DocumentList.jsx", import.meta.url), "utf8");

describe("DocumentList Round 6 integration boundaries", () => {
  it("keeps one library fetch/state owner for both rollout renderers", () => {
    expect(source.match(/getLibrary\(\{ kemBoSuuTap: true \}\)/g)).toHaveLength(1);
    expect(source).toContain("LIBRARY_ACTION_MATRIX ? matrixProjection.rows : mucHienThi.tatCa");
  });

  it("routes matrix actions through the existing shared open dispatcher", () => {
    expect(source).toMatch(/<StudyDocumentActionRow[\s\S]*?onOpen=\{moBeMat\}/);
    expect(source).toMatch(/const moBeMat = useCallback[\s\S]*?moTheoDoi\(doc, beMat, context\)/);
  });

  it("uses the shared permanent-delete dialog for collection deletion with accurate consequence copy", () => {
    expect(source).not.toContain("window.confirm(");
    expect(source).toContain("<DestructiveConfirmDialog");
    expect(source).toContain("Tài liệu bên trong không bị xoá; chúng sẽ trở về mục Chưa phân loại.");
  });

  it("binds bulk actions and Select All to the synchronously pruned visible selection", () => {
    expect(source).toContain("effectiveBulkRequest(hanhDong, daChon, matrixProjection.rows, kem)");
    expect(source).toContain("daChonHet(daChonHieuLuc, documentsDangHien)");
    expect(source).toContain("chonTatCa(documentsDangHien)");
  });
});
