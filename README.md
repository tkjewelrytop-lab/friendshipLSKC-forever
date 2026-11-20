# LSKC.

Our years together. A simple personal photo journal for the same friends and the same pose, every year since 2013.

Browse the years from 2013 through 2026 and add the real photos from each gathering. Years without photos stay empty, ready for their memories. There are no stock albums or invented gatherings.

## Add photos

1. Choose **Add photos**, then enter the gathering's date and details.
2. Select that year's same-pose group photo first, followed by other photos from the day. The first photo is the year's signature photo, so choose the upload order accordingly.
3. Choose **Save memory**. Repeat for each year you want to add.

Saved memories are local drafts in this browser on this device. They become visible to everyone after you export the updated website and publish its files. Export regularly to keep a copy outside browser storage.

## Export and publish

1. Choose **Export site**, then **Download website & photos**.
2. Extract the ZIP. It includes the website, photos, and `dist/memories.json` with your saved memories.
3. Commit the exported files to [the GitHub repository](https://github.com/tkjewelrytop-lab/friendshipLSKC-forever), keeping the `dist/` and `.github/` folders in the repository root.
4. In **Settings → Pages**, choose **GitHub Actions** as the publishing source. Once configured, the included workflow publishes updates pushed to `main`.

The published address appears in the repository's Pages settings after deployment. Saving a local memory or downloading the ZIP does not publish it automatically.

To update photos directly, place them in `dist/photos/` and edit `dist/memories.json`. Use relative paths such as `photos/lskc-2026.jpg`, and keep each gathering's signature photo first in its `photos` array.

The deployment workflow follows [GitHub's official Pages guidance](https://docs.github.com/en/pages/getting-started-with-github-pages/using-custom-workflows-with-github-pages).

## Preview locally

The site uses plain HTML, CSS, and JavaScript, with no dependencies or build step. With Node.js 20 or later installed, run:

```sh
npm start
```

Open [the local preview](http://localhost:4173). Run `npm run check` to check JavaScript syntax, local file references, and basic page metadata.
