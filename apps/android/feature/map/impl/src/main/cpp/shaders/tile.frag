#version 450

// The tile's pixels, set back by the treatment everywhere but the holes: the web's tile FS.
//
// The fade lives here, in the tile pass, rather than in an overlay drawn on top: an overlay can
// only reveal the map at the strength the tiles were drawn, never restore what this took away.
// So the holes have to be applied where the fade is.
layout(set = 0, binding = 0) uniform sampler2D u_texture;
// The holes, drawn by the mask pass at the swapchain's size: a 1:1 lookup.
layout(set = 1, binding = 0) uniform sampler2D u_cutMask;

layout(push_constant) uniform Tile {
    vec4 col0;
    vec4 col1;
    vec4 col2;
    vec4 rect;
    // x: 0 = the artwork at full strength, 1 = flat white. y: 0 = its own colour, 1 = grey.
    vec4 treatment;
} tile;

layout(location = 0) in vec2 v_texcoord;
layout(location = 0) out vec4 outColor;

void main() {
    vec4 c = texture(u_texture, v_texcoord);
    float keep = 1.0 - texture(u_cutMask, gl_FragCoord.xy / vec2(textureSize(u_cutMask, 0))).r;
    float desaturate = tile.treatment.y * keep;
    float fade = tile.treatment.x * keep;
    // Rec.709 luma, as CSS saturate() and the web's shader use.
    float luma = dot(c.rgb, vec3(0.2126, 0.7152, 0.0722));
    vec3 rgb = mix(c.rgb, vec3(luma), desaturate);
    outColor = vec4(mix(rgb, vec3(1.0), fade), 1.0);
}
