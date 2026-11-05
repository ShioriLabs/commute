// The web's SHAPE_SDF_GLSL (map-renderer-webgl.ts): signed distance from p to the edge of the
// rounded box along a → b, r wide either side and r past each end, corners rounded by cr.
// Negative inside. Shared by the mask, the pills and the ring, so all three agree on one edge,
// and with MapPoint.signedDistance, which the taps are tested against.
float shapeDistance(vec2 p, vec2 a, vec2 b, float r, float cr) {
    vec2 ab = b - a;
    float len = length(ab);
    vec2 dir = len > 0.0 ? ab / len : vec2(1.0, 0.0);
    vec2 rel = p - (a + b) * 0.5;
    vec2 lp = abs(vec2(dot(rel, dir), dot(rel, vec2(-dir.y, dir.x))));
    vec2 q = lp - vec2(len * 0.5 + r - cr, r - cr);
    return length(max(q, vec2(0.0))) + min(max(q.x, q.y), 0.0) - cr;
}
