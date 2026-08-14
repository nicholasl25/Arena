# Caption templates

Customize these defaults for your channel. The agent fills `{placeholders}` from filenames and context.

## Title templates

Pick one pattern per upload:

```
{fighterA} vs {fighterB} - who wins? #Shorts
{fighterA} vs {fighterB} | physics arena sim #Shorts
When {fighterA} fights {fighterB}… #Shorts
```

**Constraints:** ≤100 chars, include `#Shorts` in title or description.

## Description template

Hashtags only. The server picks **~6** at random from:

`#Shorts` `#physics` `#simulation` `#gaming` `#battle` `#arena` `#fight` `#minecraft` `#sandbox`

(always keeps `#Shorts`), then appends fighter tags. Same draft powers **Edit caption** / **Reload draft**.

```
#Shorts #…5 other random tags… #{fighterA} #{fighterB}
```

## Placeholder rules

| Key | Source | Example |
|-----|--------|---------|
| `{fighterA}` | First slug in filename / skin name | `Trump` |
| `{fighterB}` | Second slug in filename / skin name | `Obama` |

Fighter hashtags use the display name with non-alphanumeric characters stripped (e.g. `Trump` → `#Trump`).

## Tags (optional API field)

Default: `physics,simulation,shorts,gaming`

## Channel settings (edit once)

```yaml
channel_name: ""          # e.g. "Physics Sandbox" — leave blank to omit
default_privacy: public    # public | unlisted | private
category_id: "20"          # 20 = Gaming (ball battle simulation)
made_for_kids: true
```

## Example (filled)

**Title:** `Trump vs Obama - who wins? #Shorts`

**Description:**
```
#Shorts #physics #simulation #gaming #Trump #Obama
```
