cmake_minimum_required(VERSION 3.22.1)
project(commutemap LANGUAGES CXX)

set(CMAKE_CXX_STANDARD 20)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

# The shaders are compiled to SPIR-V with the NDK's glslc and embedded as arrays, so the library
# carries them and nothing is read from disk at runtime.
find_program(GLSLC glslc REQUIRED HINTS "${ANDROID_NDK}/shader-tools/${ANDROID_HOST_TAG}" NO_DEFAULT_PATH)

set(SHADER_DIR "${CMAKE_CURRENT_SOURCE_DIR}/shaders")
set(GENERATED_DIR "${CMAKE_CURRENT_BINARY_DIR}/generated")
file(MAKE_DIRECTORY "${GENERATED_DIR}")

set(SHADER_HEADERS)
foreach(SHADER tile.vert tile.frag)
    string(REPLACE "." "_" SHADER_NAME "${SHADER}")
    set(SPV "${GENERATED_DIR}/${SHADER}.spv")
    set(HEADER "${GENERATED_DIR}/${SHADER_NAME}.h")
    add_custom_command(
        OUTPUT "${HEADER}"
        COMMAND "${GLSLC}" --target-env=vulkan1.0 -O -o "${SPV}" "${SHADER_DIR}/${SHADER}"
        COMMAND "${CMAKE_COMMAND}" -DINPUT=${SPV} -DOUTPUT=${HEADER} -DNAME=${SHADER_NAME}
                -P "${CMAKE_CURRENT_SOURCE_DIR}/embed_spirv.cmake"
        DEPENDS "${SHADER_DIR}/${SHADER}" "${CMAKE_CURRENT_SOURCE_DIR}/embed_spirv.cmake"
        VERBATIM)
    list(APPEND SHADER_HEADERS "${HEADER}")
endforeach()
add_custom_target(map_shaders DEPENDS ${SHADER_HEADERS})

add_library(commutemap SHARED renderer.cpp jni.cpp)
add_dependencies(commutemap map_shaders)
target_include_directories(commutemap PRIVATE "${GENERATED_DIR}")
target_compile_definitions(commutemap PRIVATE VK_USE_PLATFORM_ANDROID_KHR)
# `Info info{VK_STRUCTURE_TYPE_…}` zero-fills the rest, which is the point; -Wextra counts it.
target_compile_options(commutemap PRIVATE -Wall -Wextra -Wno-missing-field-initializers -fno-exceptions -fno-rtti)
target_link_libraries(commutemap PRIVATE vulkan android jnigraphics log)
