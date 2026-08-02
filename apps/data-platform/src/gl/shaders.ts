// GLSL 300 ES shaders for the instanced dot passes. Each dot is a camera-facing
// billboard: the instance's world center is projected by u_viewProj, then the
// unit-quad corner is added IN CLIP SPACE so dots stay round circles at any
// camera tilt. A world radius r maps to a clip-space offset of r * u_proj, where
// u_proj = (1/(tan(fovY/2)*aspect), 1/tan(fovY/2)); after the perspective divide
// this yields an NDC offset of r*u_proj/w, so dots correctly shrink with
// distance. The fragment shaders draw a soft-edged disc via a radial SDF.
//
// Shared attributes:
//   a_quad     : vec2 unit quad corner in [-1,1] (the 4 billboard corners)
//   a_offset   : vec3 instance world center (divisor 1)
// Shared uniforms:
//   u_viewProj : mat4
//   u_proj     : vec2 (projection scale x,y — see above)

// --- Faint dead-dot field. Uniform color and radius except for one flag: the
// cells that spell the wordmark, which the footer beat lights up in place. The
// letters are the SAME dots at the SAME radius, only brighter — that is what
// makes the logo read as the grid illuminated rather than type laid over it.
export const FIELD_VS = /* glsl */ `#version 300 es
in vec2 a_quad;
in vec3 a_offset;
in float a_isLogo;    // 0/1
uniform mat4 u_viewProj;
uniform vec2 u_proj;
uniform float u_radius;
uniform float u_logoMix; // 0..1 wordmark reveal
out vec2 v_quad;
out float v_logo;
void main() {
  v_logo = a_isLogo * u_logoMix;
  vec4 clip = u_viewProj * vec4(a_offset, 1.0);
  // The field's radius is deliberately tiny (0.11) so the background stays
  // faint. That makes lit cells read as small rather than dim, so the wordmark
  // needs actual SIZE — alpha alone can't carry it, the disc is already opaque
  // at its centre. Grown to roughly the lit line-dot radius, which is what makes
  // the letters read as the same material as the map's own dots.
  float r = u_radius * mix(1.0, 2.1, v_logo);
  clip.xy += a_quad * r * u_proj;
  v_quad = a_quad;
  gl_Position = clip;
}
`

export const FIELD_FS = /* glsl */ `#version 300 es
precision highp float;
in vec2 v_quad;
in float v_logo;
uniform vec3 u_color;
uniform vec3 u_logoColor;
out vec4 outColor;
void main() {
  float d = length(v_quad);
  float alpha = 1.0 - smoothstep(0.85, 1.0, d);
  if (alpha <= 0.001) discard;
  vec3 color = mix(u_color, u_logoColor, v_logo);
  float a = clamp(alpha, 0.0, 1.0);
  outColor = vec4(color * a, a);
}
`

// --- Lit line dots: per-instance color, draw-in order, highlight flag.
export const DOT_VS = /* glsl */ `#version 300 es
in vec2 a_quad;
in vec3 a_offset;
in vec3 a_color;
in float a_radius;
in float a_order;      // 0..1 along the line's route (staggered reveal)
in float a_isHighlight; // 0/1
uniform mat4 u_viewProj;
uniform vec2 u_proj;
uniform float u_progress;     // 0..1 draw-in
uniform float u_highlightMix; // 0..1 topology emphasis
uniform float u_muteMix;      // 0..1 — the jpm beat greys the whole map so
                              // the structure is the only saturated thing
out vec2 v_quad;
out vec3 v_color;
out float v_alpha;
void main() {
  // Staggered reveal: this dot appears once u_progress passes a_order*0.85.
  float reveal = clamp((u_progress - a_order * 0.85) / 0.15, 0.0, 1.0);
  // Highlight: dim non-highlighted dots, brighten highlighted ones.
  float dim = mix(1.0, mix(0.3, 1.0, a_isHighlight), u_highlightMix);
  float bright = mix(1.0, mix(1.0, 1.4, a_isHighlight), u_highlightMix);
  float lum = dot(a_color, vec3(0.299, 0.587, 0.114));
  v_color = mix(a_color * bright, vec3(lum) * 0.55, u_muteMix);
  v_alpha = 0.95 * reveal * dim * mix(1.0, 0.8, u_muteMix);

  vec4 clip = u_viewProj * vec4(a_offset, 1.0);
  // Highlighted dots swell slightly under emphasis.
  float r = a_radius * mix(1.0, mix(1.0, 1.25, a_isHighlight), u_highlightMix);
  clip.xy += a_quad * r * u_proj;
  v_quad = a_quad;
  gl_Position = clip;
}
`

export const DOT_FS = /* glsl */ `#version 300 es
precision highp float;
in vec2 v_quad;
in vec3 v_color;
in float v_alpha;
out vec4 outColor;
void main() {
  if (v_alpha <= 0.001) discard;
  float d = length(v_quad);
  float a = (1.0 - smoothstep(0.8, 1.0, d)) * v_alpha;
  if (a <= 0.001) discard;
  outColor = vec4(v_color * a, a);
}
`

// --- Stations: uniform solid dots (interchanges look identical to regular
// stops now). Highlight flag brightens/dims for the topology beat.
export const STATION_VS = /* glsl */ `#version 300 es
in vec2 a_quad;
in vec3 a_offset;
in float a_radius;
in float a_isHighlight;
uniform mat4 u_viewProj;
uniform vec2 u_proj;
uniform float u_progress;
uniform float u_highlightMix;
out vec2 v_quad;
out float v_alpha;
out float v_emphasis;
void main() {
  float dim = mix(1.0, mix(0.35, 1.0, a_isHighlight), u_highlightMix);
  v_alpha = 0.9 * clamp(u_progress, 0.0, 1.0) * dim;
  v_emphasis = a_isHighlight * u_highlightMix;

  vec4 clip = u_viewProj * vec4(a_offset, 1.0);
  float r = a_radius * mix(1.0, mix(1.0, 1.2, a_isHighlight), u_highlightMix);
  clip.xy += a_quad * r * u_proj;
  v_quad = a_quad;
  gl_Position = clip;
}
`

export const STATION_FS = /* glsl */ `#version 300 es
precision highp float;
in vec2 v_quad;
in float v_alpha;
in float v_emphasis;
uniform vec3 u_stationColor; // solid dot color
out vec4 outColor;
void main() {
  if (v_alpha <= 0.001) discard;
  float d = length(v_quad);
  float disc = 1.0 - smoothstep(0.82, 1.0, d);
  if (disc <= 0.001) discard;

  // Emphasis: a subtle white core lift for highlighted stations.
  vec3 color = mix(u_stationColor, vec3(1.0), v_emphasis * 0.3 * (1.0 - smoothstep(0.0, 0.6, d)));
  float a = disc * v_alpha;
  outColor = vec4(color * a, a);
}
`

// --- Trains: instanced billboards with a soft glow halo.
export const TRAIN_VS = /* glsl */ `#version 300 es
in vec2 a_quad;
in vec3 a_offset;
in vec3 a_color;
uniform mat4 u_viewProj;
uniform vec2 u_proj;
uniform float u_radius;
out vec2 v_quad;
out vec3 v_color;
void main() {
  vec4 clip = u_viewProj * vec4(a_offset, 1.0);
  // Extra room for the glow halo (2.3x).
  clip.xy += a_quad * u_radius * 2.3 * u_proj;
  v_quad = a_quad;
  v_color = a_color;
  gl_Position = clip;
}
`

export const TRAIN_FS = /* glsl */ `#version 300 es
precision highp float;
in vec2 v_quad;
in vec3 v_color;
uniform float u_fade; // 1 normally; ramps to 0 while the jpm beat holds
out vec4 outColor;
void main() {
  float d = length(v_quad);
  // Solid core (inner ~0.43 of the padded quad) + soft glow falloff outside.
  float core = 1.0 - smoothstep(0.40, 0.46, d);
  float glow = exp(-d * 3.2) * 0.3;
  float a = clamp(core + glow, 0.0, 1.0) * u_fade;
  if (a <= 0.002) discard;
  outColor = vec4(v_color * a, a);
}
`

// --- JPM Dukuh Atas: the gated-transfer beat's structure. Each instance
// carries TWO positions and the morph lerps between them: a_flat is the dot's
// seat on the octilinear lattice, a_solid its place in the 3D structure, so the
// map's own corridor unfolds into the building as the reader scrolls.
//
// Three ramps hang off the one uniform:
//   position  — smoothstepped mix, staggered by a_level so the structure rises
//               street-first instead of translating as one rigid body;
//   alpha     — 0 until the unfold has begun (the flat seeds sit in the
//               corridor's dark gap between two highlight runs; at morph 0 this
//               pass must leave the map pixel-identical to a neighbouring
//               corridor, so it draws nothing);
//   colour    — desaturates toward the map's neutral dot grey at low morph, so
//               the fade-in doesn't flash operator colours the flat map never
//               showed.
export const JPM_VS = /* glsl */ `#version 300 es
in vec2 a_quad;
in vec3 a_flat;
in vec3 a_solid;
in vec3 a_color;
in float a_radius;
in float a_level;      // 0..1 height rank of the SOLID position
uniform mat4 u_viewProj;
uniform vec2 u_proj;
uniform float u_morph; // 0..1, eased CPU-side toward the scroll-driven target
out vec2 v_quad;
out vec3 v_color;
out float v_alpha;
void main() {
  // Stagger the unfold by level: low parts move first, the LRT deck last.
  float e = smoothstep(0.0, 1.0, clamp(u_morph * 1.25 - a_level * 0.25, 0.0, 1.0));
  vec3 p = mix(a_flat, a_solid, e);

  float aIn = smoothstep(0.0, 0.15, u_morph);
  float sat = smoothstep(0.10, 0.60, u_morph);
  v_color = mix(vec3(0.290, 0.318, 0.376), a_color, sat);
  v_alpha = 0.95 * aIn;

  vec4 clip = u_viewProj * vec4(p, 1.0);
  clip.xy += a_quad * a_radius * u_proj;
  v_quad = a_quad;
  gl_Position = clip;
}
`

export const JPM_FS = /* glsl */ `#version 300 es
precision highp float;
in vec2 v_quad;
in vec3 v_color;
in float v_alpha;
out vec4 outColor;
void main() {
  if (v_alpha <= 0.001) discard;
  float d = length(v_quad);
  float a = (1.0 - smoothstep(0.8, 1.0, d)) * v_alpha;
  if (a <= 0.001) discard;
  outColor = vec4(v_color * a, a);
}
`
