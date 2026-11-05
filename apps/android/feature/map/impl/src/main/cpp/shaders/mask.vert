#version 450
#extension GL_GOOGLE_include_directive : require

// The web's MASK_VS: each hole drawn on its own box grown by the feather, so the falloff has
// somewhere to be drawn, one instance per hole.
#include "shape_quad.glsl"

layout(push_constant) uniform Shapes {
    vec4 col0;
    vec4 col1;
    vec4 col2;
    // x: the feather, world units.
    vec4 params;
} shapes;

layout(location = 0) in vec4 a_axis;   // xy: a, zw: b
layout(location = 1) in vec3 a_shape;  // x: r, y: cr, z: alpha

layout(location = 0) out vec2 v_world;
layout(location = 1) flat out vec4 v_axis;
layout(location = 2) flat out vec3 v_shape;

void main() {
    vec2 world = shapeQuadCorner(a_axis.xy, a_axis.zw, a_shape.x, shapes.params.x);
    mat3 transform = mat3(shapes.col0.xyz, shapes.col1.xyz, shapes.col2.xyz);
    gl_Position = vec4((transform * vec3(world, 1.0)).xy, 0.0, 1.0);
    v_world = world;
    v_axis = a_axis;
    v_shape = a_shape;
}
