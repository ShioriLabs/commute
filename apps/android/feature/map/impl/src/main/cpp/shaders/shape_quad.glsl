// Vertex shaders only. The quad a shape is drawn on: its box, grown by `grow` on every side, for
// the corner of the strip gl_VertexIndex names. World units.
vec2 shapeQuadCorner(vec2 a, vec2 b, float r, float grow) {
    vec2 axis = b - a;
    float len = length(axis);
    vec2 dir = len > 0.0 ? axis / len : vec2(1.0, 0.0);
    vec2 perp = vec2(-dir.y, dir.x);
    vec2 quad = vec2(float(gl_VertexIndex & 1), float(gl_VertexIndex >> 1)) * 2.0 - 1.0;
    float halfLen = len * 0.5 + r + grow;
    return (a + b) * 0.5 + dir * (quad.x * halfLen) + perp * (quad.y * (r + grow));
}
