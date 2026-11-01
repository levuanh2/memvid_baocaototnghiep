const fs = require('fs');
const data = JSON.parse(fs.readFileSync('E:/memvid_NCKH/MemVid_BaoCaoTotNghiep/.worktrees/phase-c-round8-2-release-gate/docs/ui-ux-v4-design/round8-2-qa-evidence/agy/task1-evidence.json', 'utf8'));

console.log("=== ACCOUNT EVIDENCE SUMMARY ===");
for (const [k, v] of Object.entries(data.accountEvidence)) {
  console.log(`${k}:`);
  console.log(`  rect: ${v.rect.width}x${v.rect.height}px (left: ${v.rect.left}, right: ${v.rect.right})`);
  console.log(`  effective hit area: ${v.effectiveHitArea.envelope.width}x${v.effectiveHitArea.envelope.height}px`);
  console.log(`  nearest neighbour: ${v.nearestNeighbour ? v.nearestNeighbour.tag + ' ' + v.nearestNeighbour.className : 'none'}, gap: ${v.nearestNeighbour ? v.nearestNeighbour.gap : 'N/A'}px`);
  console.log(`  viewport right margin: ${v.rightMarginToViewport}px`);
  console.log(`  header natural width: ${v.headerMetrics.naturalContentWidth}px, clientWidth: ${v.headerMetrics.clientWidth}px`);
  console.log(`  free width: ${v.headerMetrics.freeWidth}px`);
  console.log(`  44px target met: ${v.is44pxTargetMet} (perimeter resolves: ${v.perimeterTest.resolvingPoints}/${v.perimeterTest.totalPoints}, grid: ${v.gridTest.resolvingPoints}/${v.gridTest.totalPoints})`);
}

console.log("\n=== R8-001 EVIDENCE ===");
for (const [k, v] of Object.entries(data.r8001Evidence)) {
  console.log(`${k}:`);
  console.log(`  height: ${v.headerHeight}px, isOneRow56px: ${v.isOneRow56px}`);
  console.log(`  header overflow: ${v.headerOverflowX}px, doc overflow: ${v.docOverflowX}px`);
  console.log(`  account reachable: ${v.accountCenterHit}, menu opened: ${v.accountMenuOpened}, menu contained: ${v.accountMenuContained}`);
  console.log(`  theme switch item: ${v.themeSwitchItemFound}, toggle functional: ${v.themeSwitchFunctional}`);
  console.log(`  STATUS: ${v.status}`);
}

console.log("\n=== R8-005 EVIDENCE ===");
for (const [k, v] of Object.entries(data.r8005Evidence)) {
  console.log(`${k}:`);
  console.log(`  total actions: ${v.totalActions}, all >= 44px: ${v.allRowsAtLeast44px} (min: ${v.actionMetricsSummary.minHeight}px, max: ${v.actionMetricsSummary.maxHeight}px)`);
  console.log(`  near bottom: isAbove: ${v.nearBottomContainment.isAbove}, top: ${v.nearBottomContainment.menuTop}, bottom: ${v.nearBottomContainment.menuBottom}, vh: ${v.nearBottomContainment.viewportHeight}, maxHeight: ${v.nearBottomContainment.maxHeightStyle}`);
  console.log(`  strictly contained: ${v.nearBottomContainment.strictlyContained}`);
  console.log(`  STATUS: ${v.status}`);
}
