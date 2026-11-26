import { useEffect } from "react";

// The workspace shell is one screen tall and never scrolls itself. `100vh` is the LARGEST
// viewport: on phones it ignores the browser toolbars, and on iOS it also ignores the on-screen
// keyboard (iOS shrinks only `visualViewport`). The chat composer at the bottom then sits behind
// the keyboard. This keeps `--app-height` equal to the height the learner can actually see.
//
// iOS also PANS the visual viewport to bring a focused input into view (`offsetTop > 0`): the
// visible area then starts below the top of the layout. `--app-offset-top` plus the
// `vv-panned` class move the shell down by that much, so header, messages and composer stay
// exactly inside the visible area instead of the header vanishing above it. Pinch zoom
// (`scale > 1`) also shrinks `visualViewport.height`; multiplying by `scale` keeps the shell at
// the unzoomed visible height so zooming does not reflow the page.
//
// Android Chrome resizes the layout itself (`interactive-widget=resizes-content` in index.html);
// there `visualViewport.height === innerHeight`, `offsetTop === 0`, and this is a no-op.
// Simulated in tests only: no real iPhone or Android device has been used to verify it.
export function useAppHeight() {
  useEffect(() => {
    const root = document.documentElement;
    const vv = window.visualViewport;
    let last = "";
    const set = () => {
      const scale = vv?.scale > 0 ? vv.scale : 1;
      const h = Math.round((vv?.height || window.innerHeight) * scale);
      const top = Math.max(0, Math.round(vv?.offsetTop || 0));
      if (!(h > 0)) return;
      const next = `${h}/${top}`;
      if (next === last) return; // toolbar animations fire many identical events
      last = next;
      root.style.setProperty("--app-height", `${h}px`);
      root.style.setProperty("--app-offset-top", `${top}px`);
      // Only while panned: a transform makes the shell the containing block of its fixed
      // children (the drawers). At offset 0 that box is the viewport anyway; skip it.
      root.classList.toggle("vv-panned", top > 0);
    };
    set();
    vv?.addEventListener("resize", set);
    vv?.addEventListener("scroll", set);
    window.addEventListener("resize", set);
    window.addEventListener("orientationchange", set);
    return () => {
      vv?.removeEventListener("resize", set);
      vv?.removeEventListener("scroll", set);
      window.removeEventListener("resize", set);
      window.removeEventListener("orientationchange", set);
      root.style.removeProperty("--app-height");
      root.style.removeProperty("--app-offset-top");
      root.classList.remove("vv-panned");
    };
  }, []);
}
