#version 450

// One quad per tile, its corners from the vertex index alone: (0,0) (1,0) (0,1) (1,1), drawn as a
// strip. The web's tile vertex shader (map-renderer-webgl.ts), with Vulkan's clip space, whose y
// points down as the screen's does, so the transform needs no flip.
layout(push_constant) uniform Tile {
    // The world → clip transform, a mat3's columns.
    vec4 col0;
    vec4 col1;
    vec4 col2;
    // xy: the tile's world origin; zw: its world size.
    vec4 rect;
    // x: fade, y: desaturate. Read by the fragment shader.
    vec4 treatment;
} tile;

layout(location = 0) out vec2 v_texcoord;

void main() {
    vec2 corner = vec2(float(gl_VertexIndex & 1), float(gl_VertexIndex >> 1));
    vec2 world = tile.rect.xy + corner * tile.rect.zw;
    mat3 transform = mat3(tile.col0.xyz, tile.col1.xyz, tile.col2.xyz);
    vec3 clip = transform * vec3(world, 1.0);
    gl_Position = vec4(clip.xy, 0.0, 1.0);
    v_texcoord = corner;
}
