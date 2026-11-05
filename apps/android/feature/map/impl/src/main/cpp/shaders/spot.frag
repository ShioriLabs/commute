#version 450
#extension GL_GOOGLE_include_directive : require

// The web's SPOT_FS: the selection's ring, a soft line offset outside the shape's edge with a
// glow hugging it. Purely additive light, premultiplied; the fade is the tile pass's.
#include "shape_sdf.glsl"

layout(push_constant) uniform Spot {
    vec4 axis;   // xy: a, zw: b, world units
    vec4 shape;  // x: r, y: cr, z: ring offset, w: ring width
    vec4 color;  // rgb, a: the ring's strength
    vec4 view;   // x, y: tx, ty, z: scale, surface pixels
} spot;

layout(location = 0) out vec4 outColor;

void main() {
    vec2 world = (gl_FragCoord.xy - spot.view.xy) / spot.view.z;
    float d = shapeDistance(world, spot.axis.xy, spot.axis.zw, spot.shape.x, spot.shape.y);
    float offset = spot.shape.z;
    float width = spot.shape.w;
    float ring = (1.0 - smoothstep(0.0, width, abs(d - offset))) * spot.color.a;
    float glow = exp(-max(d - offset, 0.0) / (width * 2.5)) * 0.35 * spot.color.a;
    float a = ring + glow;
    outColor = vec4(spot.color.rgb * a, a);
}
