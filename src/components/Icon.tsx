import "./Icon.css";

/** MiaoYan's icons are template images: the shape is a mask and the colour
 *  comes from the view. A CSS mask reproduces that exactly, and keeps a hover
 *  tint from needing a second asset. */
export function Icon({
  name,
  size = 16,
}: {
  name: string;
  size?: number;
}) {
  return (
    <span
      aria-hidden="true"
      className="icon"
      style={{
        width: size,
        height: size,
        WebkitMaskImage: `url(/icons/${name}.svg)`,
        maskImage: `url(/icons/${name}.svg)`,
      }}
    />
  );
}
