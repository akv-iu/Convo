import { badgeColours, DEFAULT_COLOUR, type BadgeColour } from "./badge-prefs";

/**
 * Five badge colours as a radio group of swatches. Uncontrolled and
 * server-rendered, so it works inside a plain form; a surrounding element
 * can react to the choice with `:has(#colour-<id>:checked)`.
 */
export function ColourPicker({
  defaultColour = DEFAULT_COLOUR,
  centred = false,
  quiet = false,
  hidden = false,
}: {
  defaultColour?: BadgeColour;
  /** Centre the label and swatches, e.g. under the badge. */
  centred?: boolean;
  /** Name the group for screen readers only, when a visible control already says what it colours. */
  quiet?: boolean;
  /** Out of view but still in the form (and still colouring the badge). */
  hidden?: boolean;
}) {
  return (
    <fieldset className={centred ? "text-center" : undefined} hidden={hidden}>
      <legend className={quiet ? "sr-only" : `mb-2 text-sm font-semibold ${centred ? "mx-auto" : ""}`}>Badge colour</legend>
      <div className={`flex flex-wrap gap-2 ${centred ? "justify-center" : ""}`}>
        {badgeColours.map((c) => (
          <label key={c.id} className="relative cursor-pointer" title={c.name}>
            <input
              id={`colour-${c.id}`}
              type="radio"
              name="colour"
              value={c.id}
              defaultChecked={c.id === defaultColour}
              className="peer sr-only"
            />
            <span
              aria-hidden="true"
              style={{ backgroundColor: c.hex }}
              className="block size-7 rounded-full ring-1 ring-black/10 transition-shadow peer-checked:ring-2 peer-checked:ring-foreground peer-checked:ring-offset-2 peer-checked:ring-offset-background peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-accent motion-reduce:transition-none"
            />
            <span className="sr-only">{c.name}</span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}

/**
 * Classes for an ancestor of a ColourPicker and a Badge: they set --badge
 * from whichever swatch is checked. Written out in full so Tailwind
 * generates them.
 */
export const colourFollowsPicker = "badge-follows-picker"; // rules in src/components/ui/convo.css
