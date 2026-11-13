import { useEffect } from "react";

// The workspace shell is one screen tall and never scrolls itself. `100vh` is the LARGEST
// viewport: on phones it ignores the browser toolbars, and on iOS it also ignores the on-screen
// keyboard (iOS shrinks only `visualViewport`). The chat composer at the bottom then sits behind
// the keyboard. This keeps `--app-height` equal to the height the learner can actually see.
// Android Chrome resizes the layout itself (`interactive-widget=resizes-content` in index.html);
// there `visualViewport.height === innerHeight` and this is a no-op.
export function useAppHeight() {
  useEffect(() => {
    const root = document.documentElement;
    const vv = window.visualViewport;
    const set = () => {
      const h = vv?.height || window.innerHeight;
      if (h > 0) root.style.setProperty("--app-height", `${Math.round(h)}px`);
    };
    set();
    vv?.addEventListener("resize", set);
    window.addEventListener("resize", set);
    return () => {
      vv?.removeEventListener("resize", set);
      window.removeEventListener("resize", set);
      root.style.removeProperty("--app-height");
    };
  }, []);
}
