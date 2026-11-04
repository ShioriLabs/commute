// MapNative's methods: a handle to a Renderer, and the calls the render thread makes on it.

#include <android/bitmap.h>
#include <android/native_window_jni.h>
#include <jni.h>

#include <vector>

#include "renderer.h"

using commute::map::Draw;
using commute::map::Pixels;
using commute::map::Renderer;

namespace {

Renderer *renderer(jlong handle) { return reinterpret_cast<Renderer *>(handle); }

} // namespace

extern "C" {

JNIEXPORT jlong JNICALL
Java_id_shiorilabs_commute_feature_map_render_MapNative_create(JNIEnv *env, jclass, jobject surface) {
    ANativeWindow *window = ANativeWindow_fromSurface(env, surface);
    if (window == nullptr) return 0;
    Renderer *created = Renderer::create(window);
    // The renderer took its own reference.
    ANativeWindow_release(window);
    return reinterpret_cast<jlong>(created);
}

JNIEXPORT void JNICALL
Java_id_shiorilabs_commute_feature_map_render_MapNative_destroy(JNIEnv *, jclass, jlong handle) {
    delete renderer(handle);
}

JNIEXPORT void JNICALL
Java_id_shiorilabs_commute_feature_map_render_MapNative_resize(JNIEnv *, jclass, jlong handle) {
    renderer(handle)->resize();
}

JNIEXPORT jboolean JNICALL
Java_id_shiorilabs_commute_feature_map_render_MapNative_supportsRgb565(JNIEnv *, jclass, jlong handle) {
    return renderer(handle)->supportsRgb565() ? JNI_TRUE : JNI_FALSE;
}

JNIEXPORT jstring JNICALL
Java_id_shiorilabs_commute_feature_map_render_MapNative_deviceName(JNIEnv *env, jclass, jlong handle) {
    return env->NewStringUTF(renderer(handle)->deviceName());
}

JNIEXPORT jboolean JNICALL
Java_id_shiorilabs_commute_feature_map_render_MapNative_upload(JNIEnv *env, jclass, jlong handle, jint key, jobject bitmap) {
    AndroidBitmapInfo info;
    if (AndroidBitmap_getInfo(env, bitmap, &info) != ANDROID_BITMAP_RESULT_SUCCESS) return JNI_FALSE;
    const bool rgb565 = info.format == ANDROID_BITMAP_FORMAT_RGB_565;
    if (!rgb565 && info.format != ANDROID_BITMAP_FORMAT_RGBA_8888) return JNI_FALSE;
    void *data = nullptr;
    if (AndroidBitmap_lockPixels(env, bitmap, &data) != ANDROID_BITMAP_RESULT_SUCCESS) return JNI_FALSE;
    const bool uploaded = renderer(handle)->upload(key, Pixels{data, info.width, info.height, info.stride, rgb565});
    AndroidBitmap_unlockPixels(env, bitmap);
    return uploaded ? JNI_TRUE : JNI_FALSE;
}

JNIEXPORT void JNICALL
Java_id_shiorilabs_commute_feature_map_render_MapNative_release(JNIEnv *, jclass, jlong handle, jint key) {
    renderer(handle)->release(key);
}

// `keys[i]` is drawn over the world rect `rects[4i..4i+3]` (x, y, w, h), in order.
JNIEXPORT jboolean JNICALL
Java_id_shiorilabs_commute_feature_map_render_MapNative_draw(JNIEnv *env, jclass, jlong handle, jfloat tx, jfloat ty,
                                                            jfloat scale, jintArray keys, jfloatArray rects, jint count) {
    std::vector<Draw> draws(static_cast<size_t>(count));
    if (count > 0) {
        jint *keyData = env->GetIntArrayElements(keys, nullptr);
        jfloat *rectData = env->GetFloatArrayElements(rects, nullptr);
        for (jint i = 0; i < count; i++) {
            draws[i] = Draw{keyData[i], rectData[i * 4], rectData[i * 4 + 1], rectData[i * 4 + 2], rectData[i * 4 + 3]};
        }
        env->ReleaseFloatArrayElements(rects, rectData, JNI_ABORT);
        env->ReleaseIntArrayElements(keys, keyData, JNI_ABORT);
    }
    return renderer(handle)->draw(tx, ty, scale, draws.data(), draws.size()) ? JNI_TRUE : JNI_FALSE;
}

} // extern "C"
