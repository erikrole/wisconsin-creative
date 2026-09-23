These settings should be set-and-forget. Get them right before editing — otherwise the colors you see will not be accurate.

> [!IMPORTANT]
> Confirm Premiere’s color settings before you grade. Later LUT and clip work assume Rec.709.

## Premiere Pro settings

1. Go to **File → Project Settings → Color** and match the screenshot below.

![Premiere Pro Project Settings > Color](https://qi9afrhhevnyvfmv.public.blob.vercel-storage.com/resources/color-correction-101/image01.png)

2. Confirm the same values in the **Settings** tab of the **Lumetri Color** panel. The following settings are what you should have when working with our Sony S-Log footage.

![Lumetri Color settings for Sony S-Log footage](https://qi9afrhhevnyvfmv.public.blob.vercel-storage.com/resources/color-correction-101/image02.png)

> [!NOTE]
> Certain sections of the following settings will be empty or grayed out depending on what clip is selected or what panel you have selected in Premiere Pro. The blue outline shows which panel is currently selected.

**Display Color.** Make sure **Display Color Management** is selected. This lets Premiere display accurate color on whatever display you are using.

**Project.** This is the same section as **File → Project Settings → Color**. With **Color Manage Auto-Detected Log and Raw Media** checked, Premiere should automatically detect LOG (most of our clips) or Raw and convert it to Rec.709.

> [!TIP]
> If Premiere reads the source clip incorrectly, override it in the **Source Clip** section. 99% of the time this is already correct.

**Sequence.** Set the color setup to **Direct Rec.709 (SDR)** and output into Rec.709. Wide-gamut tone mapping is out of scope for now.

**Advanced.** Check both options. Tone mapping keeps LOG/Raw highlights and lowlights in a workable SDR range so footage does not look blown out or clipped.

**Sequence Clip.** Leave **Luminance Preserving** and **Input Tone Mapping** on **Hue Preservation**. For some clips, **Max RGB** gives a more accurate red; default is fine most of the time.

## Applying the in-house LUT

With the settings above in place, edit your video normally. When you are ready to color:

1. Create an adjustment layer and drop it on a higher video track.
2. Select the adjustment layer, open **Lumetri Color → Basic Correction**, and use **Input LUT → Browse** to apply the in-house LUT for that sport.

![Adjustment layer with the in-house LUT](https://qi9afrhhevnyvfmv.public.blob.vercel-storage.com/resources/color-correction-101/image03.png)

![Lumetri Color Input LUT menu](https://qi9afrhhevnyvfmv.public.blob.vercel-storage.com/resources/color-correction-101/image04.png)

3. If you are on a computer connected to the Media Drive, open the LUTs folder and choose the `.cube` file for your sport.

```copy
/Volumes/users/shares/Media/RESOURCES/VIDEO/LUTs
```

![RESOURCES > VIDEO > LUTs folder](https://qi9afrhhevnyvfmv.public.blob.vercel-storage.com/resources/color-correction-101/image05.png)

> [!WARNING]
> If you are not connected to the Media Drive — on the road or on a laptop — bring a copy of the LUT you need and put it on your desktop or working folder.

Once the LUT is on the adjustment layer, every clip underneath it gets the LUT. Then go back to each individual clip and color correct.

## General color correction tips

> [!TIP]
> Always work on exposure and the general clip look first, before white balance, HSLs, or specific hue tweaks.

The goal is that every clip from the same environment feels like it came from the same environment. Cuts between angles should not be jarring in color or exposure.

If you exposed properly in camera, you usually need a subtle exposure nudge, a little contrast, a slight highlight bump, and a shadow decrease.

Example (every clip will be different):

![Basic exposure and contrast correction](https://qi9afrhhevnyvfmv.public.blob.vercel-storage.com/resources/color-correction-101/image06.png)

If the clip is a bit over-exposed, or jersey whites are too intense, bring down highlights and whites and ease the white curve in the area shown below. This is usually fully sunny outdoor days.

![Highlights, whites, and white-curve adjustment](https://qi9afrhhevnyvfmv.public.blob.vercel-storage.com/resources/color-correction-101/image07.png)

### Curve adjustment

![Pre-curve example](https://qi9afrhhevnyvfmv.public.blob.vercel-storage.com/resources/color-correction-101/image08.png) ![Post-curve example](https://qi9afrhhevnyvfmv.public.blob.vercel-storage.com/resources/color-correction-101/image09.png)

Clips that are not in direct sunlight — indoors, or outdoors at night — usually benefit from a classic S-curve plus basic correction.

### S-curve adjustment

![Pre-adjustments example](https://qi9afrhhevnyvfmv.public.blob.vercel-storage.com/resources/color-correction-101/image10.png) ![Post-adjustments example](https://qi9afrhhevnyvfmv.public.blob.vercel-storage.com/resources/color-correction-101/image11.png)

Adjustments on the clip above:

**Basic Correction**

![Basic Correction adjustments](https://qi9afrhhevnyvfmv.public.blob.vercel-storage.com/resources/color-correction-101/image12.png)

**Curve**

![Curve adjustments](https://qi9afrhhevnyvfmv.public.blob.vercel-storage.com/resources/color-correction-101/image13.png)

White balance is rarely perfect in camera. Pull temperature/tint the opposite way of whatever color the image leans toward. In the example below, the left image has a slight green tint, so tint was pulled away from green and temperature was nudged slightly warmer. We typically want a slightly warmer overall tone.

### White balance

![Pre-white-balanced example](https://qi9afrhhevnyvfmv.public.blob.vercel-storage.com/resources/color-correction-101/image14.png) ![Post-white-balanced example](https://qi9afrhhevnyvfmv.public.blob.vercel-storage.com/resources/color-correction-101/image15.png)

Color adjustments on the clip above:

![White-balance color adjustments](https://qi9afrhhevnyvfmv.public.blob.vercel-storage.com/resources/color-correction-101/image16.png)

> [!CAUTION]
> There is no shortcut to making every clip match. Expose and white balance in camera. Do not rely on “fix it in post.”

When shooting with the FX3, reds can read a bit red-orange compared to our red. Tweak the **Hue vs Hue** curve. Use the eyedropper in the top-right corner to select the red.

### Hue-versus-hue adjustment

![Pre hue-versus-hue adjustment](https://qi9afrhhevnyvfmv.public.blob.vercel-storage.com/resources/color-correction-101/image17.png) ![Post hue-versus-hue adjustment](https://qi9afrhhevnyvfmv.public.blob.vercel-storage.com/resources/color-correction-101/image18.png)

![Hue-versus-hue adjustment](https://qi9afrhhevnyvfmv.public.blob.vercel-storage.com/resources/color-correction-101/image19.png)
