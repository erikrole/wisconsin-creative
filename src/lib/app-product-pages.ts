import type { ProductPage } from "@/lib/app-product-page";

// Facts: Fetch and Offload READMEs and release notes (checked 2026-10-20).
export const fetchPage: ProductPage = {
  slug: "fetch", name: "Fetch", icon: "fetch", platform: "macOS",
  tagline: "Download links. Convert your files.",
  intro: "Save video and audio from the web, or turn files already on your Mac into formats that play and edit easily. Preview what you’ll get, choose where it goes, and open the finished files.",
  version: "1.5.4", requires: "macOS 27 or later",
  download: "https://github.com/erikrole/fetch-releases/releases/latest/download/Fetch.dmg",
  releases: "https://github.com/erikrole/fetch-releases/releases",
  availability: "For Apple silicon Macs. The app walks you through installing its download and conversion helpers on first launch.",
  features: [
    { title: "Links from about 1,700 sites", body: "Look up videos, playlists and podcast feeds from sites supported by yt-dlp, including YouTube, Instagram, TikTok, Vimeo and SoundCloud." },
    { title: "Video that plays on your Mac", body: "Downloads become QuickTime-compatible H.264 MP4 with AAC audio. Choose the source quality; Fetch converts the streams that need it." },
    { title: "Local files, useful formats", body: "Add video or audio files, or a whole folder. Convert video to MP4 or ProRes MOV, and audio to M4A or MP3. Originals stay unchanged." },
    { title: "Know before you convert", body: "The batch preview shows each source and output format, estimated size and time, and the save location. Already-compatible files are identified before work begins." },
    { title: "Finished files within reach", body: "Open a completed file or show the results in Finder. Filenames stay prominent, with codec and source information available in Details." },
    { title: "Use your browser sign-in", body: "Choose a supported browser in Settings for sites that need a login. Fetch uses its saved session after macOS grants access; site restrictions still apply." },
  ],
  steps: [],
  workflows: [
    { title: "Download from a link", steps: [
      { title: "Paste and look up", body: "Add an http or https link. Fetch shows the title and source; playlists and feeds let you choose a range of items." },
      { title: "Choose the output", body: "Pick Video or Audio, choose quality or audio format, and confirm the destination folder." },
      { title: "Download and open", body: "Follow progress per item, cancel or retry when needed, then open the completed file." },
    ] },
    { title: "Convert files on your Mac", steps: [
      { title: "Drop files or a folder", body: "Use Choose Files or drag media into Fetch. It finds supported video and audio files in the selection." },
      { title: "Review the batch", body: "Check formats, estimates and the save location. Audio-only batches offer audio formats without irrelevant video controls." },
      { title: "Convert and find results", body: "Start the batch, then use Open or Show Results. Fetch creates separate output files and keeps the originals." },
    ] },
  ],
  shots: [
    { file: "fetch-home.jpg", alt: "Fetch 1.5.4 opening window with Paste a link, Choose Files and a conversion format picker", caption: "One starting point for links and local files.", width: 760, height: 520 },
    { file: "fetch-download.jpg", alt: "Fetch previewing a public CleanShot video with video or audio, quality and save folder controls", caption: "Confirm the source, quality and destination before downloading.", width: 760, height: 520 },
    { file: "fetch-convert.jpg", alt: "Fetch previewing three sample WAV files converting to M4A with estimates and unchanged originals", caption: "A conversion preview shows what each file becomes. Generated sample audio is shown here.", width: 720, height: 520 },
    { file: "fetch-done.jpg", alt: "Fetch showing three completed sample audio conversions with Open and Show Results actions", caption: "Completed files have clear names and direct actions.", width: 760, height: 672 },
  ],
  notes: [
    "Requires an Apple silicon Mac running macOS 27 or later. First-run setup installs yt-dlp and ffmpeg through Homebrew.",
    "Download audio formats include MP3, M4A, Opus, FLAC and WAV. Local audio conversion offers M4A or MP3.",
    "Browser access may need approval in macOS Privacy & Security. YouTube can require a signed-in browser even for public videos.",
    "Fetch runs downloads and conversions on your Mac. Save only media you have permission to download or convert.",
    "The app checks for updates. Helper tools can be checked and updated separately in Settings. A command-line tool and Raycast extension are also available from the release page.",
  ],
};

export const offloadPage: ProductPage = {
  slug: "offload",
  name: "Offload",
  versionedDownload: true,
  icon: "offload",
  tagline: "From camera card to named footage.",
  intro: "Bring Sony FX6 and FX3 clips onto your Mac with a verified copy, match them to the game, and prepare useful filenames before you move the footage into your archive.",
  availability: "This overview shows public beta 1.5.3 for macOS 15 or later, with generated sample clips.",
  version: "1.5.3",
  platform: "macOS",
  status: "Beta",
  requires: "macOS 15.0 or later",
  download: "https://github.com/erikrole/offload-releases/releases/download/v1.5.3/Offload-1.5.3.dmg",
  releases: "https://github.com/erikrole/offload-releases/releases",
  features: [
    { title: "Verified ingest", body: "Every file is hashed as it copies, then re-read and compared. Stop at any time; running again resumes. The card is never written to." },
    { title: "Flags and metadata", body: "Choose OK or unflagged clips. ISO, shutter, white balance and timecode show on each clip." },
    { title: "Game and roster", body: "Offload reads the athletics calendar, picks the game that overlaps the clips, and loads that sport's roster." },
    { title: "Play-by-play matching", body: "Clips match to ESPN's plays by time of day, with quarter and game clock. Find Best Offset fixes a camera clock that was off." },
    { title: "Football naming", body: "A football cheatsheet preset builds names like the 2026 sheet. Every name is editable and saves to offload-names.csv." },
    { title: "Prepare the local copy", body: "Prepare for Archive renames and organizes the verified footage in that same local folder. Review the result before manually moving it to your archive; the source card stays untouched." },
    { title: "Built-in viewer", body: "Scrub by hovering, shuttle forward and in reverse, zoom, and watch Log clips converted to Rec.709 or with a .cube LUT." },
  ],
  steps: [
    { title: "Ingest", body: "Pick the card, choose which clips to bring in and a destination, then press Offload." },
    { title: "Match", body: "Offload finds the game and matches your clips to the plays. The card can be ejected by now." },
    { title: "Name", body: "Pick a template, adjust any name, and save the names beside the footage." },
  ],
  shots: [
    { file: "offload-ingest.jpg", alt: "Offload 1.5.3 showing generated Sony card clips, flag selection, a viewer and the verified-copy destination", caption: "Choose the clips and destination before a verified offload. Generated test media is shown.", width: 2560, height: 1640 },
  ],
  notes: [
    "FX6 MXF clips need Apple's Pro Video Formats installed, which comes with Final Cut Pro and Compressor.",
    "Nothing is ever named or written on the card; names go in the ingested copy.",
    "A command-line tool can scan, copy and verify a card.",
  ],
};


const wisconsinCreativePage: ProductPage = {
  slug: "wisconsin-creative", name: "Wisconsin Creative", icon: "wisconsin-creative", platform: "iPhone and iPad", shotLayout: "phones",
  tagline: "Your gear and game day, together.",
  intro: "Reserve equipment, see event and shift schedules, and look up the gear you need from your iPhone or iPad.",
  version: "1.3", requires: "iOS 26.0 or later",
  download: "https://apps.apple.com/us/app/wisconsin-creative/id6763456945", downloadLabel: "View on the App Store",
  availability: "Access is invitation-only for the Wisconsin Creative team. Downloading the app does not create an account.",
  features: [
    { title: "Reserve equipment", body: "Plan the equipment you need for a shoot and keep your reservations in the same place as the rest of your work." },
    { title: "See your schedule", body: "Check shifts, call times and event assignments while you’re away from your desk." },
    { title: "Find the right item", body: "Search equipment and use the scanner to look up an item from its code." },
    { title: "One team workflow", body: "Use the phone app for planning and reference. Physical equipment checkout, pickup and return happen at the staffed kiosk." },
  ],
  steps: [
    { title: "Sign in with your invitation", body: "Use your existing Wisconsin Creative account. Ask the team for access if you haven’t been invited." },
    { title: "Plan and check your work", body: "Review your schedule, reserve gear and look up equipment before a shoot." },
    { title: "Collect gear at the kiosk", body: "Complete the physical pickup and return with the staffed equipment workflow." },
  ],
  shots: [
    { file: "wisconsin-home.jpg", alt: "Published Wisconsin Creative App Store screenshot of the home screen", caption: "Home. Published App Store screenshot.", width: 1279, height: 2778 },
    { file: "wisconsin-schedule.jpg", alt: "Published Wisconsin Creative App Store screenshot of the schedule", caption: "Schedule. Published App Store screenshot.", width: 1279, height: 2778 },
    { file: "wisconsin-equipment.jpg", alt: "Published Wisconsin Creative App Store screenshot of equipment lookup", caption: "Equipment. Published App Store screenshot.", width: 1279, height: 2778 },
  ],
  notes: [
    "The App Store release is version 1.3 and requires iOS 26.0 or later on iPhone or iPad.",
    "Screenshots on this page come from the published App Store listing. Features and appearance may change in later versions.",
    "An invitation is required to use the team’s workspace. The public app page never displays live reservations, people or schedules.",
  ],
};

const radioClipPage: ProductPage = {
  slug: "radio-clip", name: "Radio Clip", icon: "radio", platform: "macOS", status: "In development",
  tagline: "Find the call. Make the clip.",
  intro: "A local broadcast-editing workflow that brings recordings, transcripts and official plays together, so an operator can review the moments and export MP3 highlights.",
  availability: "Coming soon. Radio Clip is a working development build; there is no public download or announced release version yet.",
  features: [
    { title: "Start from the recording", body: "Attach a local broadcast recording and keep the project’s source media and edit decisions together." },
    { title: "Connect transcript and plays", body: "The development workflow uses local transcription and imported official plays to suggest moments worth reviewing." },
    { title: "Listen before approving", body: "Review candidate clips, adjust the in and out points, and approve the calls you want to keep. Suggestions still need an operator’s judgment." },
    { title: "Export the highlights", body: "Prepare named MP3 clips from the selected moments for the next step in production." },
  ],
  workflowTitle: "The development workflow",
  steps: [
    { title: "Bring in a broadcast", body: "Attach the recording and the game’s play list to a local project." },
    { title: "Find and review moments", body: "Use transcript and play context to locate candidates, then listen and adjust the cuts." },
    { title: "Choose the export batch", body: "Select the clips to keep and export the MP3 files." },
  ],
  shots: [
    { file: "radio-clip-preview.jpg", alt: "Radio Clip development build showing a sample broadcast and fictional plays for listening review", caption: "Development preview with generated audio and sample plays. The interface is still changing.", width: 2760, height: 1800 },
  ],
  notes: [
    "Radio Clip is in development, not a publicly released product. Availability and final system requirements have not been announced.",
    "The preview uses generated sample data. It does not show a live broadcast project or imply that automatic matching is editorial approval.",
  ],
};

const mediaLabPage: ProductPage = {
  slug: "media-lab", name: "Media Lab", icon: "media-lab", platform: "Media library", status: "In development",
  tagline: "Find the footage where it already lives.",
  intro: "A media library being built around the existing media drive: searchable metadata, photo and video previews, and naming review without moving everything into a new storage system.",
  availability: "In development, with availability planned for late 2026. There is no public download or release version yet.",
  features: [
    { title: "Browse the existing archive", body: "Index media on the current drive and explore it through a library view without importing a second copy of every file." },
    { title: "Search useful metadata", body: "Find indexed media by its recorded context and inspect the file’s metadata alongside it." },
    { title: "Preview before opening", body: "Use photo and video previews to decide whether a file is the one you need before opening it in an editor." },
    { title: "Review naming suggestions", body: "Inspect suggested names and identity matches before applying changes. The default preview workflow leaves archive files unchanged." },
  ],
  workflowTitle: "The development workflow",
  steps: [
    { title: "Index a media location", body: "Point the library at a drive or folder that already holds the media." },
    { title: "Search and inspect", body: "Browse indexed files, check their metadata and preview the media." },
    { title: "Review the next action", body: "Use the file context to select footage or review proposed naming changes." },
  ],
  shots: [
    { file: "media-lab-preview.png", alt: "Media Lab development library with generated color-bar clips, search and media filters", caption: "Development preview with generated test media. The interface is still changing.", width: 1440, height: 900 },
  ],
  notes: [
    "Media Lab is in development. Final availability, system requirements and deployment details have not been announced.",
    "The screenshot uses an isolated test library with generated media. It contains no live archive or team data.",
  ],
};

export const productPages = [fetchPage, offloadPage, wisconsinCreativePage, radioClipPage, mediaLabPage];
