import type { Messages } from "../../core";
import type ru from "../ru/shareCard";

export default {
  button: "Image",
  buttonTitle: "A trade image to share with friends",
  rowAria: "Trade image for {ticker}",
  title: "Trade image",
  description: "A {ticker} card for your friends. It is drawn in the browser and never uploaded.",
  previewAlt: "Preview of the {ticker} trade image",
  drawing: "Drawing…",
  themes: {
    label: "Background",
    olymp: "Olympus",
    marble: "Marble",
    night: "Night",
    photo: "Your photo",
  },
  art: {
    prev: "Previous painting",
    next: "Next painting",
    position: "{n} of {total}",
    pick: "Painting: {credit}",
  },
  photo: {
    pick: "Choose a photo",
    change: "Another photo",
    hint: "The photo stays on this device and is never uploaded.",
    failed: "Couldn't open this image",
  },
  result: {
    label: "Result",
    usd: "Net P&L in $",
    r: "In R",
    pct: "% of the position",
    rOnly: "The desk hides $ amounts on images.",
  },
  toggles: {
    showName: "Show name",
    showPrices: "Show prices",
  },
  chart: {
    fallback: "No minute bars for this day — the image shows a straight line from entry to exit.",
    none: "No bars and no prices — the image has no chart.",
  },
  actions: {
    download: "Download PNG",
    copy: "Copy",
    share: "Share",
  },
  toast: {
    downloaded: "Image saved",
    copied: "Image copied — paste it into a chat",
    copyUnsupported: "This browser can't copy images. Use «Download PNG».",
    copyFailed: "Couldn't copy the image",
    shareFailed: "Couldn't share. Download the PNG and send it as a file.",
    renderFailed: "Couldn't draw the image",
  },
} satisfies Messages<typeof ru>;
