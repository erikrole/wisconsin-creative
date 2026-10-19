import type { ProductPage } from "@/lib/app-product-page";

// Facts: Fetch and Offload READMEs and release notes (checked 2026-10-15).
export const fetchPage: ProductPage = {
  slug: "fetch",
  name: "Fetch",
  icon: "fetch",
  tagline: "Saves videos and audio from a link.",
  intro: "Paste a YouTube, Instagram, X or podcast link, pick a folder, and get an MP4 or MP3 on your Mac.",
  version: "1.1.0",
  requires: "macOS 27 or later",
  download: "https://github.com/erikrole/fetch-releases/releases/latest/download/Fetch.dmg",
  releases: "https://github.com/erikrole/fetch-releases/releases",
  features: [
    { title: "About 1,700 sites", body: "Anything yt-dlp supports: YouTube, Instagram, X, TikTok, Facebook, Reddit, Vimeo, SoundCloud, direct file links, and podcast feeds." },
    { title: "Video or audio", body: "Video saves as H.264 MP4 and converts only the streams that need it. Audio only offers MP3, M4A, Opus, FLAC and WAV." },
    { title: "Playlists and feeds", body: "Look up a playlist or podcast feed and download a range of items, such as 1-5. Feeds default to the newest episode." },
    { title: "Plain-language errors", body: "Each download shows speed and time left. Cancel or retry any time; partial files resume. Failures say what to do next." },
    { title: "Private videos", body: "Sites that need a login, such as Instagram, some X and Vimeo, use the browser login you choose in Settings." },
    { title: "Raycast and Terminal", body: "Fetch accepts fetch:// links, and a fetch command-line tool and Raycast extension can hand it a link." },
  ],
  steps: [
    { title: "Paste a link", body: "Fetch looks up the video, playlist or feed and shows what it found." },
    { title: "Choose a folder", body: "Pick Video (MP4) or Audio only, then where to save it." },
    { title: "Download", body: "Watch progress per item. Open the file when it finishes." },
  ],
  shots: [
    { file: "fetch-main.png", alt: "Fetch downloading a video from a link", caption: "Fetch downloading a real link.", width: 1600, height: 1000 },
    { file: "fetch-done.png", alt: "Fetch with a finished download", caption: "A finished download, ready in the chosen folder.", width: 1600, height: 1000 },
  ],
  notes: [
    "First run walks through a short tour and a one-button setup for yt-dlp and ffmpeg, which Fetch installs with Homebrew.",
    "Fetch only opens http and https links and runs on your own Mac.",
    "YouTube may require the browser where you are signed in, even for a public video.",
  ],
};

export const offloadPage: ProductPage = {
  slug: "offload",
  name: "Offload",
  icon: "offload",
  tagline: "Gets Sony FX6 and FX3 clips off the card, names them from the play-by-play, and files them in the archive.",
  intro: "It reads each clip's OK, KEEP or NG flag, then copies the card with SHA-256 verification.",
  version: "1.2.0",
  requires: "macOS 15.0 or later",
  download: "https://github.com/erikrole/offload-releases/releases/latest/download/Offload.dmg",
  releases: "https://github.com/erikrole/offload-releases/releases",
  features: [
    { title: "Verified ingest", body: "Every file is hashed as it copies, then re-read and compared. Stop at any time; running again resumes. The card is never written to." },
    { title: "Flags and metadata", body: "Choose OK, KEEP or unflagged clips. ISO, shutter, white balance and timecode show on each clip." },
    { title: "Game and roster", body: "Offload reads the athletics calendar, picks the game that overlaps the clips, and loads that sport's roster." },
    { title: "Play-by-play matching", body: "Clips match to ESPN's plays by time of day, with quarter and game clock. Find Best Offset fixes a camera clock that was off." },
    { title: "Football naming", body: "A football cheatsheet preset builds names like the 2026 sheet. Every name is editable and saves to offload-names.csv." },
    { title: "Built-in viewer", body: "Scrub by hovering, shuttle forward and in reverse, zoom, and watch Log clips converted to Rec.709 or with a .cube LUT." },
  ],
  steps: [
    { title: "Ingest", body: "Pick the card, choose which clips to bring in and a destination, then press Offload." },
    { title: "Match", body: "Offload finds the game and matches your clips to the plays. The card can be ejected by now." },
    { title: "Name", body: "Pick a template, adjust any name, and save the names beside the footage." },
  ],
  shots: [
    { file: "offload-ingest.png", alt: "Offload showing clips from a Sony FX6 card", caption: "Real FX6 clips in the Ingest step.", width: 1600, height: 1000 },
    { file: "offload-match.png", alt: "Offload matching clips to plays", caption: "Clips matched to the game's play-by-play.", width: 1600, height: 1000 },
  ],
  notes: [
    "FX6 MXF clips need Apple's Pro Video Formats installed, which comes with Final Cut Pro and Compressor.",
    "Nothing is ever named or written on the card; names go in the ingested copy.",
    "A command-line tool can scan, copy and verify a card.",
  ],
};
