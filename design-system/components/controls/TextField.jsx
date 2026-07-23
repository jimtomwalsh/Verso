import React from "react";

/**
 * TextField — free text entry. The counterpart to IconField (which is for
 * short/numeric values): TextField is for prose — alt text, captions, a
 * disclaimer, a link URL, a chapter name. Set `multiline` for a growing
 * textarea. Full-width by default so it sits under its label.
 */
export function TextField({
  value,
  placeholder,
  multiline = false,
  rows = 3,
  disabled = false,
  leadingIcon,
  onChange,
  style,
  ...rest
}) {
  const [focus, setFocus] = React.useState(false);
  const [hover, setHover] = React.useState(false);

  const shell = {
    display: "flex",
    alignItems: multiline ? "flex-start" : "center",
    gap: "6px",
    width: "100%",
    minHeight: "var(--control-md)",
    padding: multiline ? "6px 8px" : "0 8px",
    background: "var(--surface-input)",
    borderRadius: "var(--radius-xs)",
    border: "1px solid",
    borderColor: focus ? "var(--border-focus)" : hover && !disabled ? "var(--border-input)" : "transparent",
    boxShadow: focus ? "inset 0 0 0 1px var(--border-focus)" : "none",
    opacity: disabled ? 0.5 : 1,
    transition: "border-color var(--dur-fast) var(--ease-standard)",
    ...style,
  };

  const inputBase = {
    flex: 1,
    minWidth: 0,
    width: "100%",
    border: "none",
    outline: "none",
    background: "transparent",
    color: "var(--text-primary)",
    font: "var(--type-value)",
    padding: 0,
    resize: "none",
    fontFamily: "var(--font-ui)",
  };

  return (
    <label
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={shell}
    >
      {leadingIcon && <LeadingGlyph name={leadingIcon} multiline={multiline} />}
      {multiline ? (
        <textarea
          value={value ?? ""}
          placeholder={placeholder}
          disabled={disabled}
          rows={rows}
          onFocus={() => setFocus(true)}
          onBlur={() => setFocus(false)}
          onChange={(e) => onChange && onChange(e.target.value)}
          style={{ ...inputBase, lineHeight: "var(--leading-normal)" }}
          {...rest}
        />
      ) : (
        <input
          type="text"
          value={value ?? ""}
          placeholder={placeholder}
          disabled={disabled}
          onFocus={() => setFocus(true)}
          onBlur={() => setFocus(false)}
          onChange={(e) => onChange && onChange(e.target.value)}
          style={inputBase}
          {...rest}
        />
      )}
    </label>
  );
}

function LeadingGlyph({ name, multiline }) {
  // Lazy require to avoid a hard import cycle in the bundle.
  const Icon = (typeof window !== "undefined" && window.VersoDesignSystem_2a48ac && window.VersoDesignSystem_2a48ac.Icon) || null;
  if (!Icon) return null;
  return (
    <span style={{ flex: "none", color: "var(--icon-idle)", paddingTop: multiline ? "2px" : 0 }}>
      <Icon name={name} size={14} />
    </span>
  );
}
