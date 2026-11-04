# Writes the SPIR-V in INPUT to OUTPUT as `static const uint32_t NAME[]`, for the renderer to hand
# straight to vkCreateShaderModule. SPIR-V is a stream of 32-bit little-endian words.
file(READ "${INPUT}" HEX HEX)
string(LENGTH "${HEX}" HEX_LENGTH)
set(WORDS "")
set(OFFSET 0)
while(OFFSET LESS HEX_LENGTH)
    string(SUBSTRING "${HEX}" ${OFFSET} 8 WORD)
    # Bytes b0 b1 b2 b3 on disk are the word 0xb3b2b1b0.
    string(SUBSTRING "${WORD}" 0 2 B0)
    string(SUBSTRING "${WORD}" 2 2 B1)
    string(SUBSTRING "${WORD}" 4 2 B2)
    string(SUBSTRING "${WORD}" 6 2 B3)
    string(APPEND WORDS "0x${B3}${B2}${B1}${B0},")
    math(EXPR OFFSET "${OFFSET} + 8")
endwhile()
file(WRITE "${OUTPUT}" "// Generated from ${INPUT}; do not edit.\n#pragma once\n#include <cstdint>\nstatic const uint32_t ${NAME}[] = {${WORDS}};\n")
