// Shared right-side context inspector.  The legacy implementation lives in
// SidebarRight because it also owns the existing generation/polling flows;
// this stable owner gives every workspace mode one shell and one mount.
import SidebarRight from "./SidebarRight";

export default function ContextInspector(props) {
  return <SidebarRight {...props} />;
}
