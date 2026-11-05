#version 450
#extension GL_GOOGLE_include_directive : require

// The web's PILL_FS: the capsule filled, its edge antialiased over a pixel, premultiplied.
#include "shape_sdf.glsl"

layout(push_constant) uniform Shapes {
    vec4 col0;
    vec4 col1;
    vec4 col2;
    vec4 params;
} shapes;

layout(location = 0) in vec2 v_world;
layout(location = 1) flat in vec4 v_axis;
layout(location = 2) flat in vec2 v_shape;
layout(location = 3) flat in vec4 v_color;

layout(location = 0) out vec4 outColor;

void main() {
    float d = shapeDistance(v_world, v_axis.xy, v_axis.zw, v_shape.x, v_shape.y);
    float edge = shapes.params.x;
    float alpha = 1.0 - smoothstep(-edge, edge, d);
    if (alpha <= 0.0) discard;
    float a = v_color.a * alpha;
    outColor = vec4(v_color.rgb * a, a);
}
