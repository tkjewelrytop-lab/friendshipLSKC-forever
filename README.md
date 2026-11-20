# LSKC.

A personal photo timeline: the same friends, the same pose, every year since 2013. Each year can contain several gatherings and as many published photos as you add over time.

- [Public album](https://tkjewelrytop-lab.github.io/friendshipLSKC-forever/) — a timeline for viewing memories, with no upload controls.
- [Owner upload page](https://tkjewelrytop-lab.github.io/friendshipLSKC-forever/admin.html) — add photos directly to the GitHub repository.
- [Repository](https://github.com/tkjewelrytop-lab/friendshipLSKC-forever)

## Set up owner access

Create a fine-grained personal access token yourself using the GitHub account that owns this repository, or an authorized organization member account:

1. On GitHub, open **Settings → Developer settings → Personal access tokens → Fine-grained tokens → Generate new token**. [Open the token creation page](https://github.com/settings/personal-access-tokens/new).
2. Give it a name and expiration, then set **Resource owner** to `tkjewelrytop-lab`.
3. Under **Repository access**, choose **Only select repositories**, then select `friendshipLSKC-forever`.
4. Under **Permissions → Repository permissions**, set **Contents** to **Read and write**, then choose **Generate token**. Organization approval may be required before a token can write.

These steps follow [GitHub's token setup instructions](https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/managing-your-personal-access-tokens#creating-a-fine-grained-personal-access-token). The upload page changes only photos and album data, so the token needs no Actions or Workflows permission. GitHub documents the required [Contents permission for Git database operations](https://docs.github.com/en/rest/git/trees#create-a-tree).

Paste the token into the owner upload page, never into chat or a repository file. The page holds it in memory only; it does not save it in browser storage. Reloading or disconnecting clears access from the page.

## Add photos

Open the owner upload page and choose **Connect** after entering your token. Enter the gathering's date and details, choose your photos, then choose **Publish memory**. Select the same-pose group photo first to make it the gathering's signature photo. You can add more than one gathering in a year; the public album groups them under that year.

Each upload accepts up to **20 photos**, up to **20 MB each**. Photos are resized to a maximum of **2,000 pixels on the longest edge** and compressed as JPEG at quality **0.88** before being sent to GitHub. Choose **Add more photos** beside an existing memory to add another batch to that gathering.

A successful upload commits the photos and album data to `main`. The existing GitHub Pages workflow then publishes the update; allow time for the deployment to finish and refresh the public album. There is no fixed publication time. Photos and captions are public in this repository and on the album.

## Album files

- `dist/memories.json` is an array of gatherings. It starts as `[]` while the album has no real uploads.
- Each gathering has `id`, `title`, `date` (`YYYY-MM-DD`), `location`, `description`, and a `photos` array.
- Each photo has a relative `src`, such as `./photos/gathering-id/001.jpg`, and a `caption`.
- The first photo is the signature photo. Multiple photos and multiple gatherings per year are supported.

The admin page uses GitHub's REST API as the storage backend. No separate upload server is required. Actual authenticated uploads need the owner's token; the source checks do not verify a real owner upload.

## Preview locally

The site uses plain HTML, CSS, and JavaScript with no dependencies or build step. With Node.js 20 or later:

```sh
npm start
```

Open [the public preview](http://localhost:4173/) or [the admin preview](http://localhost:4173/admin.html). Run `npm run check` to check both pages, JavaScript modules, relative file references, and the album data format.
