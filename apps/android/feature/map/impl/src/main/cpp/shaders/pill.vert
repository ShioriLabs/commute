#version 450
#extension GL_GOOGLE_include_directive : require

// The web's PILL_VS: a capsule on its own box, one instance per capsule, each in its own colour.
#include "shape_quad.glsl"

layout(push_constant) uniform Shapes {
    vec4 col0;
    vec4 col1;
    vec4 col2;
    // x: how soft the edge is, world units (a pixel's worth).
    vec4 params;
} shapes;

layout(location = 0) in vec4 a_axis;   // xy: a, zw: b
layout(location = 1) in vec2 a_shape;  // x: r, y: cr
layout(location = 2) in vec4 a_color;  // straight alpha

layout(location = 0) out vec2 v_world;
layout(location = 1) flat out vec4 v_axis;
layout(location = 2) flat out vec2 v_shape;
layout(location = 3) flat out vec4 v_color;

void main() {
    // Grown by the soft edge, so it isn't clipped off at the box.
    vec2 world = shapeQuadCorner(a_axis.xy, a_axis.zw, a_shape.x, shapes.params.x);
    mat3 transform = mat3(shapes.col0.xyz, shapes.col1.xyz, shapes.col2.xyz);
    gl_Position = vec4((transform * vec3(world, 1.0)).xy, 0.0, 1.0);
    v_world = world;
    v_axis = a_axis;
    v_shape = a_shape;
    v_color = a_color;
}
