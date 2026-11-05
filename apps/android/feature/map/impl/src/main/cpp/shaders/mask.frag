#version 450
#extension GL_GOOGLE_include_directive : require

// The web's MASK_FS: coverage, 1 inside the hole falling to 0 across the feather, scaled by the
// hole's own alpha. Coverage rather than distance, as the holes are unioned by blending with MAX.
#include "shape_sdf.glsl"

layout(push_constant) uniform Shapes {
    vec4 col0;
    vec4 col1;
    vec4 col2;
    vec4 params;
} shapes;

layout(location = 0) in vec2 v_world;
layout(location = 1) flat in vec4 v_axis;
layout(location = 2) flat in vec3 v_shape;

layout(location = 0) out vec4 outColor;

void main() {
    float d = shapeDistance(v_world, v_axis.xy, v_axis.zw, v_shape.x, v_shape.y);
    float cover = (1.0 - smoothstep(0.0, shapes.params.x, d)) * v_shape.z;
    if (cover <= 0.0) discard;
    outColor = vec4(cover, 0.0, 0.0, 1.0);
}
