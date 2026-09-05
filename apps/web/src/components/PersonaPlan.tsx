import type { PersonaId } from "@knot/shared";
import { ALL_PERSONA_IDS } from "@knot/shared";
import { PERSONA_HUE, PERSONA_PITCH, personaFirstName, personaRole } from "../design/personas.js";

/**
 * The panel picker.
 *
 * The server already accepts an arbitrary ordered `plan`, so this is a real
 * control rather than a display: the order you tick them is the order you face
 * them, and the number on the left is the round they'll be.
 */
export function PersonaPlan({
  plan,
  onChange,
}: {
  plan: PersonaId[];
  onChange: (next: PersonaId[]) => void;
}) {
  function toggle(id: PersonaId) {
    const at = plan.indexOf(id);
    if (at === -1) onChange([...plan, id]);
    // Never let them empty the panel — there'd be no interview to run.
    else if (plan.length > 1) onChange(plan.filter((p) => p !== id));
  }

  return (
    <div>
      <div className="flex items-baseline justify-between gap-4">
        <h2 className="font-measure text-[12px] text-dim">your panel</h2>
        <span className="font-measure text-[11px] text-faint">
          {plan.length} {plan.length === 1 ? "round" : "rounds"}
        </span>
      </div>
      <p className="mt-1.5 text-[13.5px] leading-snug text-faint">
        Pick who you want to face. They come in the order you tick them.
      </p>

      <ul className="mt-4 space-y-px">
        {ALL_PERSONA_IDS.map((id) => {
          const order = plan.indexOf(id);
          const on = order !== -1;
          const hue = PERSONA_HUE[id];
          const last = on && plan.length === 1;

          return (
            <li key={id}>
              <button
                type="button"
                aria-pressed={on}
                disabled={last}
                onClick={() => toggle(id)}
                title={last ? "Keep at least one interviewer" : undefined}
                className={[
                  "group flex w-full items-start gap-3.5 rounded-[3px] px-3 py-3 text-left",
                  "transition-colors duration-150",
                  on ? "bg-graphite-850" : "hover:bg-graphite-900",
                  last ? "cursor-default" : "cursor-pointer",
                ].join(" ")}
                style={{
                  boxShadow: on ? `inset 2px 0 0 0 ${hue}` : "inset 2px 0 0 0 transparent",
                }}
              >
                {/* Run order, or an empty socket when they're off the panel. */}
                <span
                  aria-hidden="true"
                  className="font-measure mt-[3px] grid h-5 w-5 shrink-0 place-items-center rounded-full text-[11px] leading-none"
                  style={
                    on
                      ? { background: hue, color: "var(--color-graphite-975)" }
                      : {
                          border: "1px dashed var(--color-edge)",
                          color: "transparent",
                        }
                  }
                >
                  {on ? order + 1 : "0"}
                </span>

                <span className="min-w-0 flex-1">
                  <span className="flex flex-wrap items-baseline gap-x-2">
                    <span
                      className="text-[16px] leading-tight"
                      style={{ color: on ? "var(--color-speak)" : "var(--color-dim)" }}
                    >
                      {personaFirstName(id)}
                    </span>
                    <span className="font-measure text-[11px]" style={{ color: on ? hue : "var(--color-faint)" }}>
                      {personaRole(id).toLowerCase()}
                    </span>
                  </span>
                  <span
                    className="mt-1 block text-[13.5px] leading-snug transition-colors duration-150"
                    style={{ color: on ? "var(--color-dim)" : "var(--color-faint)" }}
                  >
                    {PERSONA_PITCH[id]}
                  </span>
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
