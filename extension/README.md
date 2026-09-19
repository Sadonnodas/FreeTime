# Add to FreeTime — Chrome extension

Sends what you are looking at to FreeTime's **Add to FreeTime** screen, filled
in, for you to file in a project and add. It saves nothing itself: FreeTime
does the saving, so everything syncs as usual.

## Install (once, per computer)

1. In Chrome, open **chrome://extensions**
2. Turn on **Developer mode** (top right).
3. Click **Load unpacked** and choose this `extension` folder
   (`FreeTime/extension` in the repo).
4. Click the puzzle-piece icon in Chrome's toolbar and **pin** "Add to FreeTime",
   so the dinosaur sits next to the address bar.

**After pulling a new version of the repo, press the ↻ on the extension's card
in chrome://extensions** — Chrome keeps running the old copy until you do.

## Use

- **Click the dinosaur** on any page:
  - a shop's product page → a **to-buy**, with name, price, link and photo
  - text selected on the page → a **note**, with where it came from
  - anything else → an **idea**, with its link
- **Right-click** for the others:
  - *Add this page to FreeTime* (ignores any selection)
  - *Add selected text to FreeTime*
  - *Add this link to FreeTime*
  - *Add this image to FreeTime as a to-buy*
  - *Screenshot to a FreeTime to-do* — what you can see, as the to-do's photo

FreeTime opens in a small window at the right edge of your browser, on the
Add screen. Change anything, pick where it goes (remembered for next time) and
tap **Add** — the window closes itself. **Cancel** closes it without adding.

It is a window of its own rather than a panel inside the page on purpose:
inside a shop's page Chrome would give FreeTime separate, empty storage, so
your projects would not be there and nothing added would reach the real app.

## Why it asks to "read and change all your data on all websites"

Chrome words it that way for any extension that may read the page you are on.
This one reads a page only when you click it, and only to find the product's
name, price and photo; it also fetches that photo to shrink it. Nothing is sent
anywhere except to FreeTime, and only after the `#` of the address, which a
browser never sends to a server.
