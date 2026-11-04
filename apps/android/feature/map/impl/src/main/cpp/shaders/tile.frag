#version 450

// The tile's own pixels, as the web's tile shader draws them with no selection showing.
layout(set = 0, binding = 0) uniform sampler2D u_texture;

layout(location = 0) in vec2 v_texcoord;
layout(location = 0) out vec4 outColor;

void main() {
    outColor = texture(u_texture, v_texcoord);
}
