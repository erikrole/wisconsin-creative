Use this guide to create captions in Adobe Premiere, export an `.srt` file for the website, and export a video with burned-in captions for social.

> [!IMPORTANT]
> The approved caption preset and style live on the Media Drive. Do not download a preset from Resources or substitute a personal preset.

```copy
/Volumes/users/shares/Media/RESOURCES/VIDEO/CAPTIONS
```

> [!TIP]
> Add captions when the edit is finished or close to finished. Later timeline changes can require caption segments to be repaired or recreated.

## Prepare the Premiere sequence

Open the project and activate the finished or nearly finished sequence.

Before captioning:

- Confirm that the sequence contains the correct edit.
- Confirm that the dialogue is audible.
- Confirm that the frame size and aspect ratio match the intended delivery.
- Save the project.
- Keep the project and working media in the approved Media Drive location.

## Create the transcript

1. Select **Window → Text**.
2. In the Text panel, open the **Transcript** tab.

![Transcript tab in the Premiere Text panel](/resources/video-captioning/02-caption-generation.png)

3. If the active sequence does not have a transcript, open the Transcript tab menu and choose **Generate static transcript**.
4. Choose the spoken language and the audio track that contains the dialogue. Enable speaker labeling when identifying speakers will help the review.
5. Select **Transcribe**.

![Premiere transcribing the sequence audio](/resources/video-captioning/04-transcript.png)

6. Wait for transcription to finish. Read the transcript from beginning to end and correct names, places, organizations, sports, and technical terms. If a correct transcript already exists, use it instead of creating a duplicate.

Adobe explains the language, speaker-labeling, audio-analysis, In/Out range, and transcript-merging controls in [Auto transcribe video using Speech to Text](https://helpx.adobe.com/premiere/desktop/add-text-images/insert-captions/auto-transcribe-video-using-speech-to-text.html).

## Apply the default settings from the file

1. In the Text panel, open the **Captions** tab.
2. Select **Create captions from transcript**.

![Create captions from transcript in the Captions tab](/resources/video-captioning/01-create-captions.png)

3. Premiere opens the Create captions dialog. Select the approved caption preset. If it is not listed, open the menu beside **Caption preset**, choose **Import preset…**, open the captions folder on the Media Drive, and select the approved caption preset file.

![Import preset command in the Caption preset menu](/resources/video-captioning/17-caption-preset-import.png)

4. Confirm that the imported preset supplies these defaults:

   | Setting | Value |
   | --- | --- |
   | Format | Subtitle |
   | Style | `Caption_16x9` |
   | Lines | Double Line |
   | Maximum length | 50 characters |
   | Minimum duration | 2.0 seconds |
   | Gap between captions | 0 frames |

![Approved defaults in the Create captions dialog](/resources/video-captioning/18-caption-settings-dialog.png)

5. Select **Create captions**. Premiere creates timed caption segments on a separate caption track aligned with the dialogue.

![Caption track created above the sequence audio](/resources/video-captioning/08-caption-track-timeline.png)

> [!NOTE]
> Before the Wisconsin style is applied, captions may have Premiere’s plain default appearance.

![Plain caption appearance before applying the Wisconsin style](/resources/video-captioning/16-finished-video-still.jpg)
![Finished video with the approved Wisconsin caption style](/resources/video-captioning/20-final-captioned-video-still.jpg)

Adobe defines each Create captions control in [Create captions in Premiere](https://helpx.adobe.com/sg/premiere/desktop/add-text-images/insert-captions/create-captions.html).

## Apply the preset and style

The caption preset controls how Premiere creates the timed segments. The caption style controls how those segments look.

1. Select the caption track or a caption segment.
2. Open the **Edit** tab of the **Properties** panel.
3. Find **Track Style**.

![Track Style in the Premiere Properties panel](/resources/video-captioning/12-caption-style-final.png)

4. Select the add button beside Track Style.

![Add button beside Track Style](/resources/video-captioning/11-style-application.png)

5. Open the captions folder on the Media Drive.
6. Select the approved style for the delivery aspect ratio. For a 16:9 sequence, use `Caption_16x9.prtextstyle`.

![Caption style files in the Media Drive folder](/resources/video-captioning/13-media-drive-caption-folder.png)

7. When Premiere displays the Import Text Style dialog, click **OK**.

![Import Text Style confirmation dialog](/resources/video-captioning/14-caption-style-selected.png)

8. Open the Track Style menu and choose `Caption_16x9`.

![Caption_16x9 selected from the Track Style menu](/resources/video-captioning/15-caption-timeline-final.png)

The track style applies the shared text, appearance, alignment, and position settings to the caption track. Adobe documents this workflow in [Create Linked and Track Styles](https://helpx.adobe.com/ie/premiere/desktop/add-text-images/stylize-text/create-linked-and-track-styles.html).

## Review and edit the captions

Work through every caption in order while listening to the audio and watching the Program Monitor.

Check for:

- Correct spelling and punctuation.
- Correct names, titles, sports, locations, and organizations.
- No missing or duplicated words.
- Natural line breaks.
- Timing that follows the spoken phrase.
- Enough time to read each caption.
- No caption that remains after the speaker finishes.
- Readability over bright, dark, moving, and detailed footage.

![Generated captions ready for a full review](/resources/video-captioning/05-caption-review.png)

Edit text in the Text panel, or select the caption in the Program Monitor and edit it directly on the video.

![Editing a caption in the Text panel](/resources/video-captioning/06-caption-editing.png)

Use **Merge captions** when two adjacent segments are too short or split a thought awkwardly. After merging, read the combined caption again and confirm that its line length and timing remain readable.

![Merge captions control in the Text panel](/resources/video-captioning/07-caption-track.png)

Play the full sequence once more after the text pass. Watch the caption track against the audio waveform and correct any segment that starts early, appears late, flashes, or lingers.

## Export the SRT file for the website

1. Open the **Captions** tab.
2. Open the **More** menu.
3. Choose **Export → Export to SRT file…**.
4. Save the `.srt` file in the approved project or Media Drive location.
5. Confirm that the file exists and uses the same base filename as the video.

![Export to SRT file from the Captions tab](/resources/video-captioning/19-text-panel-export-srt.png)

> [!NOTE]
> The `.srt` file is the separate caption deliverable for the website. It does not place captions into the video image and does not replace the social export.

Adobe identifies `.srt` as a supported one-track sidecar format in [Export caption tracks](https://helpx.adobe.com/ca/premiere/desktop/render-and-export/export-files/export-caption-tracks.html).

## Export the burned-in video for social

Before exporting, confirm that:

- The approved caption preset and `Caption_16x9` style are applied.
- The full caption track has been reviewed.
- The `.srt` file has been exported for the website.
- The sequence uses the correct source media.
- The output location is the approved project or media path.

1. Open Premiere’s Export workspace.
2. Open the **Captions** section.
3. Set **Export Options** to **Burn Captions Into Video**.
4. Complete the normal video export for the intended social destination.

![Burn Captions Into Video in Premiere export settings](/resources/video-captioning/09-caption-style.png)

> [!WARNING]
> Burned-in captions become part of the video image and cannot be turned off during playback. Open the exported file outside Premiere and watch it from beginning to end.

Adobe compares burned-in, sidecar, and embedded caption exports in the [Export settings reference](https://helpx.adobe.com/ca/premiere/desktop/render-and-export/export-files/overview-of-export-settings.html).

## Final operator checklist

- The correct sequence was active and saved.
- The transcript was created from **Window → Text** and reviewed.
- Captions were created from the reviewed transcript.
- The approved caption preset supplied the default creation settings.
- The approved Media Drive style was applied to the caption track.
- Names, places, organizations, sports, and technical terms are correct.
- Short or awkward adjacent segments were merged where appropriate.
- Timing, line breaks, and readability were checked across the full sequence.
- The `.srt` file was exported for the website.
- The social video was exported with **Burn Captions Into Video**.
- The exported video was watched outside Premiere.
- The project, `.srt`, and final video are saved in the approved Media Drive location.

## Good to know: Premiere terms

- A **transcript** is editable text generated from spoken audio. It is not yet a timed caption track.
- A **caption** is a timed segment of transcript text with a start and end time.
- A **caption track** is the timeline track that contains caption segments.
- A **caption preset** stores the caption-creation settings used to divide a transcript into timed segments.
- A **caption style** controls the captions’ visual appearance, alignment, and position.
- An **SRT sidecar file** is a separate timed-text file. The website uses this file to provide optional captions.
- **Burned-in captions** are rendered into the video image. Viewers cannot turn them off.
