#pragma once

#include <android/native_window.h>
#include <vulkan/vulkan.h>

#include <cstdint>
#include <unordered_map>
#include <vector>

namespace commute::map {

// A tile's pixels as they come from an Android Bitmap: RGB_565 or RGBA_8888, rows `stride` bytes
// apart.
struct Pixels {
    const void *data;
    uint32_t width;
    uint32_t height;
    uint32_t stride;
    bool rgb565;
};

// One textured quad in world units: a tile, or the preview under them.
struct Draw {
    int32_t key;
    float x, y, w, h;
};

// The map's Vulkan renderer: textures by key, and frames of quads under one world → screen
// transform. Everything else (which tiles, when) is decided in Kotlin. Not thread-safe: every call
// comes from the render thread.
class Renderer {
public:
    // Null when Vulkan can't draw to `window` on this device. Takes a reference to `window`.
    static Renderer *create(ANativeWindow *window);
    ~Renderer();

    Renderer(const Renderer &) = delete;
    Renderer &operator=(const Renderer &) = delete;

    // Whether textures can be RGB_565: half the memory of RGBA, for opaque tiles.
    bool supportsRgb565() const { return rgb565Supported_; }

    const char *deviceName() const { return deviceName_; }

    // The window changed size: the swapchain is rebuilt before the next frame.
    void resize() { swapchainDirty_ = true; }

    // Uploads `pixels` as texture `key`, with a full mip chain, replacing what `key` held.
    bool upload(int32_t key, const Pixels &pixels);

    // Lets go of texture `key` once no frame in flight still samples it.
    void release(int32_t key);

    // Draws `draws` in order over white, `world * scale + (tx, ty)` in window pixels. False when
    // the device is lost, after which the renderer can't draw again.
    bool draw(float tx, float ty, float scale, const Draw *draws, size_t count);

private:
    static constexpr uint32_t kFramesInFlight = 2;

    struct Texture {
        VkImage image = VK_NULL_HANDLE;
        VkDeviceMemory memory = VK_NULL_HANDLE;
        VkImageView view = VK_NULL_HANDLE;
        VkDescriptorSet descriptor = VK_NULL_HANDLE;
    };

    struct Garbage {
        Texture texture;
        uint64_t frame;
    };

    struct Frame {
        VkCommandBuffer commands = VK_NULL_HANDLE;
        VkSemaphore imageAvailable = VK_NULL_HANDLE;
        VkFence inFlight = VK_NULL_HANDLE;
    };

    Renderer() = default;

    bool init(ANativeWindow *window);
    bool createSwapchain();
    void destroySwapchain();
    bool createPipeline();
    bool findMemoryType(uint32_t typeBits, VkMemoryPropertyFlags properties, uint32_t *index) const;
    void destroyTexture(Texture &texture);
    void collectGarbage(bool all);

    ANativeWindow *window_ = nullptr;
    VkInstance instance_ = VK_NULL_HANDLE;
    VkSurfaceKHR surface_ = VK_NULL_HANDLE;
    VkPhysicalDevice physical_ = VK_NULL_HANDLE;
    VkPhysicalDeviceMemoryProperties memoryProperties_{};
    VkDevice device_ = VK_NULL_HANDLE;
    uint32_t queueFamily_ = 0;
    VkQueue queue_ = VK_NULL_HANDLE;
    char deviceName_[VK_MAX_PHYSICAL_DEVICE_NAME_SIZE] = {};
    bool rgb565Supported_ = false;

    VkSwapchainKHR swapchain_ = VK_NULL_HANDLE;
    VkFormat swapchainFormat_ = VK_FORMAT_UNDEFINED;
    VkExtent2D extent_{};
    std::vector<VkImage> images_;
    std::vector<VkImageView> imageViews_;
    std::vector<VkFramebuffer> framebuffers_;
    // One per swapchain image: an image's semaphore is only reused once it is acquired again.
    std::vector<VkSemaphore> renderFinished_;
    bool swapchainDirty_ = false;

    VkRenderPass renderPass_ = VK_NULL_HANDLE;
    VkDescriptorSetLayout descriptorLayout_ = VK_NULL_HANDLE;
    VkPipelineLayout pipelineLayout_ = VK_NULL_HANDLE;
    VkPipeline pipeline_ = VK_NULL_HANDLE;
    VkDescriptorPool descriptorPool_ = VK_NULL_HANDLE;
    VkSampler sampler_ = VK_NULL_HANDLE;
    VkCommandPool commandPool_ = VK_NULL_HANDLE;

    Frame frames_[kFramesInFlight];
    uint64_t frameNumber_ = 0;

    std::unordered_map<int32_t, Texture> textures_;
    std::vector<Garbage> garbage_;
};

} // namespace commute::map
