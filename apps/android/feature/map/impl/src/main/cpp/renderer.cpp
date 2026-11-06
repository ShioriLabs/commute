#include "renderer.h"

#include <android/log.h>

#include <algorithm>
#include <cmath>
#include <cstring>

#include "mask_frag.h"
#include "mask_vert.h"
#include "pill_frag.h"
#include "pill_vert.h"
#include "spot_frag.h"
#include "spot_vert.h"
#include "tile_frag.h"
#include "tile_vert.h"

#define LOG_TAG "MapRenderer"
#define LOGE(...) __android_log_print(ANDROID_LOG_ERROR, LOG_TAG, __VA_ARGS__)
#define LOGI(...) __android_log_print(ANDROID_LOG_INFO, LOG_TAG, __VA_ARGS__)

// Logs a failed call with where it was, and returns false from the function it's in.
#define VK_TRY(call)                                                              \
    do {                                                                          \
        VkResult result_ = (call);                                                \
        if (result_ != VK_SUCCESS) {                                              \
            LOGE("%s failed: %d (%s:%d)", #call, result_, __FILE__, __LINE__);    \
            return false;                                                         \
        }                                                                         \
    } while (0)

namespace commute::map {

namespace {

// A tile's textures and the preview, and a little room to replace one while its old one waits out
// the frames still sampling it.
constexpr uint32_t kMaxTextures = 256;

// The tile pass's push constants: the world → clip transform's columns, the quad's world rect,
// and the treatment (fade, desaturate).
struct TilePush {
    float col0[4];
    float col1[4];
    float col2[4];
    float rect[4];
    float treatment[4];
};
static_assert(sizeof(TilePush) == 80, "Push constants must stay within the guaranteed 128 bytes");

// The mask's and the pills' push constants: the transform, and one parameter (the feather, or
// the pills' soft edge), world units.
struct ShapePush {
    float col0[4];
    float col1[4];
    float col2[4];
    float params[4];
};
static_assert(sizeof(ShapePush) == 64, "Push constants must stay within the guaranteed 128 bytes");

// The ring's: its shape, offset and width, colour and strength, and the camera.
struct SpotPush {
    float axis[4];
    float shape[4];
    float color[4];
    float view[4];
};
static_assert(sizeof(SpotPush) == 64, "Push constants must stay within the guaranteed 128 bytes");

// The overlay's float layout, mirroring OverlayPack.kt.
namespace OverlayLayout {
constexpr size_t kFade = 0;
constexpr size_t kDesaturate = 1;
constexpr size_t kFeather = 2;
constexpr size_t kCutCount = 3;
constexpr size_t kPillCount = 4;
constexpr size_t kRingOn = 5;
constexpr size_t kRing = 6;
constexpr size_t kHeader = 18;
constexpr size_t kCutStride = 7;
constexpr size_t kPillStride = 10;
} // namespace OverlayLayout

// The smallest instance buffer worth making: about a thousand pills.
constexpr VkDeviceSize kMinInstanceBytes = 64 * 1024;

uint32_t mipLevels(uint32_t width, uint32_t height) {
    return static_cast<uint32_t>(std::floor(std::log2(std::max(width, height)))) + 1;
}

bool blitFilterable(VkPhysicalDevice physical, VkFormat format) {
    VkFormatProperties properties;
    vkGetPhysicalDeviceFormatProperties(physical, format, &properties);
    const VkFormatFeatureFlags needed = VK_FORMAT_FEATURE_SAMPLED_IMAGE_BIT |
                                        VK_FORMAT_FEATURE_SAMPLED_IMAGE_FILTER_LINEAR_BIT |
                                        VK_FORMAT_FEATURE_BLIT_SRC_BIT | VK_FORMAT_FEATURE_BLIT_DST_BIT;
    return (properties.optimalTilingFeatures & needed) == needed;
}

} // namespace

Renderer *Renderer::create(ANativeWindow *window) {
    auto *renderer = new Renderer();
    if (!renderer->init(window)) {
        delete renderer;
        return nullptr;
    }
    return renderer;
}

bool Renderer::init(ANativeWindow *window) {
    window_ = window;
    ANativeWindow_acquire(window_);

    uint32_t apiVersion = VK_API_VERSION_1_0;
    auto enumerateVersion = reinterpret_cast<PFN_vkEnumerateInstanceVersion>(
        vkGetInstanceProcAddr(VK_NULL_HANDLE, "vkEnumerateInstanceVersion"));
    if (enumerateVersion != nullptr) {
        enumerateVersion(&apiVersion);
    }

    VkApplicationInfo app{VK_STRUCTURE_TYPE_APPLICATION_INFO};
    app.pApplicationName = "Commute";
    app.pEngineName = "commute-map";
    app.apiVersion = apiVersion >= VK_API_VERSION_1_1 ? VK_API_VERSION_1_1 : VK_API_VERSION_1_0;

    const char *instanceExtensions[] = {VK_KHR_SURFACE_EXTENSION_NAME, VK_KHR_ANDROID_SURFACE_EXTENSION_NAME};
    VkInstanceCreateInfo instanceInfo{VK_STRUCTURE_TYPE_INSTANCE_CREATE_INFO};
    instanceInfo.pApplicationInfo = &app;
    instanceInfo.enabledExtensionCount = 2;
    instanceInfo.ppEnabledExtensionNames = instanceExtensions;
    VK_TRY(vkCreateInstance(&instanceInfo, nullptr, &instance_));

    VkAndroidSurfaceCreateInfoKHR surfaceInfo{VK_STRUCTURE_TYPE_ANDROID_SURFACE_CREATE_INFO_KHR};
    surfaceInfo.window = window_;
    VK_TRY(vkCreateAndroidSurfaceKHR(instance_, &surfaceInfo, nullptr, &surface_));

    uint32_t deviceCount = 0;
    VK_TRY(vkEnumeratePhysicalDevices(instance_, &deviceCount, nullptr));
    std::vector<VkPhysicalDevice> devices(deviceCount);
    VK_TRY(vkEnumeratePhysicalDevices(instance_, &deviceCount, devices.data()));
    for (VkPhysicalDevice candidate : devices) {
        uint32_t familyCount = 0;
        vkGetPhysicalDeviceQueueFamilyProperties(candidate, &familyCount, nullptr);
        std::vector<VkQueueFamilyProperties> families(familyCount);
        vkGetPhysicalDeviceQueueFamilyProperties(candidate, &familyCount, families.data());
        for (uint32_t i = 0; i < familyCount; i++) {
            VkBool32 present = VK_FALSE;
            vkGetPhysicalDeviceSurfaceSupportKHR(candidate, i, surface_, &present);
            if ((families[i].queueFlags & VK_QUEUE_GRAPHICS_BIT) && present) {
                physical_ = candidate;
                queueFamily_ = i;
                break;
            }
        }
        if (physical_ != VK_NULL_HANDLE) break;
    }
    if (physical_ == VK_NULL_HANDLE) {
        LOGE("No GPU can present to the map's surface");
        return false;
    }

    VkPhysicalDeviceProperties properties;
    vkGetPhysicalDeviceProperties(physical_, &properties);
    std::strncpy(deviceName_, properties.deviceName, sizeof(deviceName_) - 1);
    vkGetPhysicalDeviceMemoryProperties(physical_, &memoryProperties_);
    rgb565Supported_ = blitFilterable(physical_, VK_FORMAT_R5G6B5_UNORM_PACK16);
    if (!blitFilterable(physical_, VK_FORMAT_R8G8B8A8_UNORM)) {
        LOGE("%s can't filter and blit RGBA8 textures", deviceName_);
        return false;
    }
    LOGI("Drawing the map on %s (Vulkan %u.%u, RGB565 %s)", deviceName_, VK_API_VERSION_MAJOR(properties.apiVersion),
         VK_API_VERSION_MINOR(properties.apiVersion), rgb565Supported_ ? "yes" : "no");

    const float priority = 1.0f;
    VkDeviceQueueCreateInfo queueInfo{VK_STRUCTURE_TYPE_DEVICE_QUEUE_CREATE_INFO};
    queueInfo.queueFamilyIndex = queueFamily_;
    queueInfo.queueCount = 1;
    queueInfo.pQueuePriorities = &priority;
    const char *deviceExtensions[] = {VK_KHR_SWAPCHAIN_EXTENSION_NAME};
    VkDeviceCreateInfo deviceInfo{VK_STRUCTURE_TYPE_DEVICE_CREATE_INFO};
    deviceInfo.queueCreateInfoCount = 1;
    deviceInfo.pQueueCreateInfos = &queueInfo;
    deviceInfo.enabledExtensionCount = 1;
    deviceInfo.ppEnabledExtensionNames = deviceExtensions;
    VK_TRY(vkCreateDevice(physical_, &deviceInfo, nullptr, &device_));
    vkGetDeviceQueue(device_, queueFamily_, 0, &queue_);

    VkCommandPoolCreateInfo poolInfo{VK_STRUCTURE_TYPE_COMMAND_POOL_CREATE_INFO};
    poolInfo.flags = VK_COMMAND_POOL_CREATE_RESET_COMMAND_BUFFER_BIT;
    poolInfo.queueFamilyIndex = queueFamily_;
    VK_TRY(vkCreateCommandPool(device_, &poolInfo, nullptr, &commandPool_));

    for (Frame &frame : frames_) {
        VkCommandBufferAllocateInfo allocInfo{VK_STRUCTURE_TYPE_COMMAND_BUFFER_ALLOCATE_INFO};
        allocInfo.commandPool = commandPool_;
        allocInfo.level = VK_COMMAND_BUFFER_LEVEL_PRIMARY;
        allocInfo.commandBufferCount = 1;
        VK_TRY(vkAllocateCommandBuffers(device_, &allocInfo, &frame.commands));
        VkSemaphoreCreateInfo semaphoreInfo{VK_STRUCTURE_TYPE_SEMAPHORE_CREATE_INFO};
        VK_TRY(vkCreateSemaphore(device_, &semaphoreInfo, nullptr, &frame.imageAvailable));
        VkFenceCreateInfo fenceInfo{VK_STRUCTURE_TYPE_FENCE_CREATE_INFO};
        fenceInfo.flags = VK_FENCE_CREATE_SIGNALED_BIT;
        VK_TRY(vkCreateFence(device_, &fenceInfo, nullptr, &frame.inFlight));
    }

    VkSamplerCreateInfo samplerInfo{VK_STRUCTURE_TYPE_SAMPLER_CREATE_INFO};
    samplerInfo.magFilter = VK_FILTER_LINEAR;
    samplerInfo.minFilter = VK_FILTER_LINEAR;
    samplerInfo.mipmapMode = VK_SAMPLER_MIPMAP_MODE_LINEAR;
    samplerInfo.addressModeU = VK_SAMPLER_ADDRESS_MODE_CLAMP_TO_EDGE;
    samplerInfo.addressModeV = VK_SAMPLER_ADDRESS_MODE_CLAMP_TO_EDGE;
    samplerInfo.addressModeW = VK_SAMPLER_ADDRESS_MODE_CLAMP_TO_EDGE;
    samplerInfo.maxLod = VK_LOD_CLAMP_NONE;
    VK_TRY(vkCreateSampler(device_, &samplerInfo, nullptr, &sampler_));

    // The mask is read 1:1 with the screen, so nearest is exact.
    VkSamplerCreateInfo maskSamplerInfo{VK_STRUCTURE_TYPE_SAMPLER_CREATE_INFO};
    maskSamplerInfo.magFilter = VK_FILTER_NEAREST;
    maskSamplerInfo.minFilter = VK_FILTER_NEAREST;
    maskSamplerInfo.addressModeU = VK_SAMPLER_ADDRESS_MODE_CLAMP_TO_EDGE;
    maskSamplerInfo.addressModeV = VK_SAMPLER_ADDRESS_MODE_CLAMP_TO_EDGE;
    maskSamplerInfo.addressModeW = VK_SAMPLER_ADDRESS_MODE_CLAMP_TO_EDGE;
    VK_TRY(vkCreateSampler(device_, &maskSamplerInfo, nullptr, &maskSampler_));

    const uint32_t maxSets = kMaxTextures + kFramesInFlight;
    VkDescriptorPoolSize poolSize{VK_DESCRIPTOR_TYPE_COMBINED_IMAGE_SAMPLER, maxSets};
    VkDescriptorPoolCreateInfo descriptorPoolInfo{VK_STRUCTURE_TYPE_DESCRIPTOR_POOL_CREATE_INFO};
    descriptorPoolInfo.flags = VK_DESCRIPTOR_POOL_CREATE_FREE_DESCRIPTOR_SET_BIT;
    descriptorPoolInfo.maxSets = maxSets;
    descriptorPoolInfo.poolSizeCount = 1;
    descriptorPoolInfo.pPoolSizes = &poolSize;
    VK_TRY(vkCreateDescriptorPool(device_, &descriptorPoolInfo, nullptr, &descriptorPool_));

    // One combined image sampler, for the fragment shader: a tile's texture, or a frame's mask.
    VkDescriptorSetLayoutBinding binding{};
    binding.binding = 0;
    binding.descriptorType = VK_DESCRIPTOR_TYPE_COMBINED_IMAGE_SAMPLER;
    binding.descriptorCount = 1;
    binding.stageFlags = VK_SHADER_STAGE_FRAGMENT_BIT;
    VkDescriptorSetLayoutCreateInfo layoutInfo{VK_STRUCTURE_TYPE_DESCRIPTOR_SET_LAYOUT_CREATE_INFO};
    layoutInfo.bindingCount = 1;
    layoutInfo.pBindings = &binding;
    VK_TRY(vkCreateDescriptorSetLayout(device_, &layoutInfo, nullptr, &descriptorLayout_));

    for (Frame &frame : frames_) {
        VkDescriptorSetAllocateInfo setInfo{VK_STRUCTURE_TYPE_DESCRIPTOR_SET_ALLOCATE_INFO};
        setInfo.descriptorPool = descriptorPool_;
        setInfo.descriptorSetCount = 1;
        setInfo.pSetLayouts = &descriptorLayout_;
        VK_TRY(vkAllocateDescriptorSets(device_, &setInfo, &frame.maskDescriptor));
    }

    // The mask pass: coverage of every hole, cleared to none each frame and read by the tile pass.
    VkAttachmentDescription mask{};
    mask.format = VK_FORMAT_R8_UNORM;
    mask.samples = VK_SAMPLE_COUNT_1_BIT;
    mask.loadOp = VK_ATTACHMENT_LOAD_OP_CLEAR;
    mask.storeOp = VK_ATTACHMENT_STORE_OP_STORE;
    mask.stencilLoadOp = VK_ATTACHMENT_LOAD_OP_DONT_CARE;
    mask.stencilStoreOp = VK_ATTACHMENT_STORE_OP_DONT_CARE;
    mask.initialLayout = VK_IMAGE_LAYOUT_UNDEFINED;
    mask.finalLayout = VK_IMAGE_LAYOUT_SHADER_READ_ONLY_OPTIMAL;
    VkAttachmentReference maskReference{0, VK_IMAGE_LAYOUT_COLOR_ATTACHMENT_OPTIMAL};
    VkSubpassDescription maskSubpass{};
    maskSubpass.pipelineBindPoint = VK_PIPELINE_BIND_POINT_GRAPHICS;
    maskSubpass.colorAttachmentCount = 1;
    maskSubpass.pColorAttachments = &maskReference;
    VkSubpassDependency maskDependencies[2]{};
    // Written only once the last frame to read this mask has finished reading it.
    maskDependencies[0].srcSubpass = VK_SUBPASS_EXTERNAL;
    maskDependencies[0].dstSubpass = 0;
    maskDependencies[0].srcStageMask = VK_PIPELINE_STAGE_FRAGMENT_SHADER_BIT;
    maskDependencies[0].dstStageMask = VK_PIPELINE_STAGE_COLOR_ATTACHMENT_OUTPUT_BIT;
    maskDependencies[0].srcAccessMask = VK_ACCESS_SHADER_READ_BIT;
    maskDependencies[0].dstAccessMask = VK_ACCESS_COLOR_ATTACHMENT_WRITE_BIT;
    // Read by the tile pass only once it's written.
    maskDependencies[1].srcSubpass = 0;
    maskDependencies[1].dstSubpass = VK_SUBPASS_EXTERNAL;
    maskDependencies[1].srcStageMask = VK_PIPELINE_STAGE_COLOR_ATTACHMENT_OUTPUT_BIT;
    maskDependencies[1].dstStageMask = VK_PIPELINE_STAGE_FRAGMENT_SHADER_BIT;
    maskDependencies[1].srcAccessMask = VK_ACCESS_COLOR_ATTACHMENT_WRITE_BIT;
    maskDependencies[1].dstAccessMask = VK_ACCESS_SHADER_READ_BIT;
    VkRenderPassCreateInfo maskPassInfo{VK_STRUCTURE_TYPE_RENDER_PASS_CREATE_INFO};
    maskPassInfo.attachmentCount = 1;
    maskPassInfo.pAttachments = &mask;
    maskPassInfo.subpassCount = 1;
    maskPassInfo.pSubpasses = &maskSubpass;
    maskPassInfo.dependencyCount = 2;
    maskPassInfo.pDependencies = maskDependencies;
    VK_TRY(vkCreateRenderPass(device_, &maskPassInfo, nullptr, &maskPass_));

    if (!createSwapchain()) return false;
    return createPipelines();
}

Renderer::~Renderer() {
    if (device_ != VK_NULL_HANDLE) {
        vkDeviceWaitIdle(device_);
        collectGarbage(true);
        for (auto &[key, texture] : textures_) destroyTexture(texture);
        textures_.clear();
        destroySwapchain();
        if (swapchain_) vkDestroySwapchainKHR(device_, swapchain_, nullptr);
        for (VkPipeline pipeline : {tilePipeline_, maskPipeline_, pillPipeline_, spotPipeline_}) {
            if (pipeline) vkDestroyPipeline(device_, pipeline, nullptr);
        }
        if (tileLayout_) vkDestroyPipelineLayout(device_, tileLayout_, nullptr);
        if (shapeLayout_) vkDestroyPipelineLayout(device_, shapeLayout_, nullptr);
        if (descriptorLayout_) vkDestroyDescriptorSetLayout(device_, descriptorLayout_, nullptr);
        if (renderPass_) vkDestroyRenderPass(device_, renderPass_, nullptr);
        if (maskPass_) vkDestroyRenderPass(device_, maskPass_, nullptr);
        if (descriptorPool_) vkDestroyDescriptorPool(device_, descriptorPool_, nullptr);
        if (sampler_) vkDestroySampler(device_, sampler_, nullptr);
        if (maskSampler_) vkDestroySampler(device_, maskSampler_, nullptr);
        for (Frame &frame : frames_) {
            if (frame.imageAvailable) vkDestroySemaphore(device_, frame.imageAvailable, nullptr);
            if (frame.inFlight) vkDestroyFence(device_, frame.inFlight, nullptr);
            if (frame.instances) vkDestroyBuffer(device_, frame.instances, nullptr);
            if (frame.instanceMemory) vkFreeMemory(device_, frame.instanceMemory, nullptr);
        }
        if (commandPool_) vkDestroyCommandPool(device_, commandPool_, nullptr);
        vkDestroyDevice(device_, nullptr);
    }
    if (surface_ != VK_NULL_HANDLE) vkDestroySurfaceKHR(instance_, surface_, nullptr);
    if (instance_ != VK_NULL_HANDLE) vkDestroyInstance(instance_, nullptr);
    if (window_ != nullptr) ANativeWindow_release(window_);
}

void Renderer::detach() {
    if (surface_ == VK_NULL_HANDLE) return;
    vkDeviceWaitIdle(device_);
    destroySwapchain();
    if (swapchain_) vkDestroySwapchainKHR(device_, swapchain_, nullptr);
    swapchain_ = VK_NULL_HANDLE;
    vkDestroySurfaceKHR(instance_, surface_, nullptr);
    surface_ = VK_NULL_HANDLE;
    ANativeWindow_release(window_);
    window_ = nullptr;
}

bool Renderer::attach(ANativeWindow *window) {
    detach();
    window_ = window;
    ANativeWindow_acquire(window_);
    VkAndroidSurfaceCreateInfoKHR surfaceInfo{VK_STRUCTURE_TYPE_ANDROID_SURFACE_CREATE_INFO_KHR};
    surfaceInfo.window = window_;
    VkBool32 present = VK_FALSE;
    if (vkCreateAndroidSurfaceKHR(instance_, &surfaceInfo, nullptr, &surface_) != VK_SUCCESS ||
        vkGetPhysicalDeviceSurfaceSupportKHR(physical_, queueFamily_, surface_, &present) != VK_SUCCESS || !present ||
        !createSwapchain()) {
        LOGE("Couldn't draw into the new surface");
        detach();
        return false;
    }
    return true;
}

bool Renderer::createSwapchain() {
    VkSurfaceCapabilitiesKHR capabilities;
    VK_TRY(vkGetPhysicalDeviceSurfaceCapabilitiesKHR(physical_, surface_, &capabilities));

    uint32_t formatCount = 0;
    VK_TRY(vkGetPhysicalDeviceSurfaceFormatsKHR(physical_, surface_, &formatCount, nullptr));
    std::vector<VkSurfaceFormatKHR> formats(formatCount);
    VK_TRY(vkGetPhysicalDeviceSurfaceFormatsKHR(physical_, surface_, &formatCount, formats.data()));
    // UNORM, not sRGB: the tiles' bytes are already sRGB and pass through untouched, as on the web.
    VkSurfaceFormatKHR chosen = formats.empty() ? VkSurfaceFormatKHR{} : formats[0];
    for (const VkSurfaceFormatKHR &format : formats) {
        if (format.format == VK_FORMAT_R8G8B8A8_UNORM || format.format == VK_FORMAT_B8G8R8A8_UNORM) {
            chosen = format;
            break;
        }
    }
    if (swapchainFormat_ != VK_FORMAT_UNDEFINED && chosen.format != swapchainFormat_) {
        LOGE("The surface's format changed under the render pass");
        return false;
    }
    swapchainFormat_ = chosen.format;

    if (renderPass_ == VK_NULL_HANDLE) {
        VkAttachmentDescription color{};
        color.format = swapchainFormat_;
        color.samples = VK_SAMPLE_COUNT_1_BIT;
        color.loadOp = VK_ATTACHMENT_LOAD_OP_CLEAR;
        color.storeOp = VK_ATTACHMENT_STORE_OP_STORE;
        color.stencilLoadOp = VK_ATTACHMENT_LOAD_OP_DONT_CARE;
        color.stencilStoreOp = VK_ATTACHMENT_STORE_OP_DONT_CARE;
        color.initialLayout = VK_IMAGE_LAYOUT_UNDEFINED;
        color.finalLayout = VK_IMAGE_LAYOUT_PRESENT_SRC_KHR;
        VkAttachmentReference reference{0, VK_IMAGE_LAYOUT_COLOR_ATTACHMENT_OPTIMAL};
        VkSubpassDescription subpass{};
        subpass.pipelineBindPoint = VK_PIPELINE_BIND_POINT_GRAPHICS;
        subpass.colorAttachmentCount = 1;
        subpass.pColorAttachments = &reference;
        // The clear waits for the acquire semaphore, which signals at this stage.
        VkSubpassDependency dependency{};
        dependency.srcSubpass = VK_SUBPASS_EXTERNAL;
        dependency.dstSubpass = 0;
        dependency.srcStageMask = VK_PIPELINE_STAGE_COLOR_ATTACHMENT_OUTPUT_BIT;
        dependency.dstStageMask = VK_PIPELINE_STAGE_COLOR_ATTACHMENT_OUTPUT_BIT;
        dependency.dstAccessMask = VK_ACCESS_COLOR_ATTACHMENT_WRITE_BIT;
        VkRenderPassCreateInfo passInfo{VK_STRUCTURE_TYPE_RENDER_PASS_CREATE_INFO};
        passInfo.attachmentCount = 1;
        passInfo.pAttachments = &color;
        passInfo.subpassCount = 1;
        passInfo.pSubpasses = &subpass;
        passInfo.dependencyCount = 1;
        passInfo.pDependencies = &dependency;
        VK_TRY(vkCreateRenderPass(device_, &passInfo, nullptr, &renderPass_));
    }

    extent_ = capabilities.currentExtent;
    if (extent_.width == UINT32_MAX) {
        extent_.width = static_cast<uint32_t>(ANativeWindow_getWidth(window_));
        extent_.height = static_cast<uint32_t>(ANativeWindow_getHeight(window_));
    }
    if (extent_.width == 0 || extent_.height == 0) {
        // Not laid out yet; the next resize builds it.
        swapchainDirty_ = true;
        return true;
    }

    uint32_t imageCount = capabilities.minImageCount + 1;
    if (capabilities.maxImageCount > 0) imageCount = std::min(imageCount, capabilities.maxImageCount);

    VkCompositeAlphaFlagBitsKHR alpha = VK_COMPOSITE_ALPHA_INHERIT_BIT_KHR;
    for (VkCompositeAlphaFlagBitsKHR candidate : {VK_COMPOSITE_ALPHA_OPAQUE_BIT_KHR, VK_COMPOSITE_ALPHA_INHERIT_BIT_KHR}) {
        if (capabilities.supportedCompositeAlpha & candidate) {
            alpha = candidate;
            break;
        }
    }

    VkSwapchainKHR old = swapchain_;
    VkSwapchainCreateInfoKHR info{VK_STRUCTURE_TYPE_SWAPCHAIN_CREATE_INFO_KHR};
    info.surface = surface_;
    info.minImageCount = imageCount;
    info.imageFormat = chosen.format;
    info.imageColorSpace = chosen.colorSpace;
    info.imageExtent = extent_;
    info.imageArrayLayers = 1;
    info.imageUsage = VK_IMAGE_USAGE_COLOR_ATTACHMENT_BIT;
    info.imageSharingMode = VK_SHARING_MODE_EXCLUSIVE;
    // Drawn unrotated: in the phone's natural portrait that is the display's own orientation, and
    // turned sideways the compositor rotates the frames instead.
    info.preTransform = (capabilities.supportedTransforms & VK_SURFACE_TRANSFORM_IDENTITY_BIT_KHR)
                            ? VK_SURFACE_TRANSFORM_IDENTITY_BIT_KHR
                            : capabilities.currentTransform;
    info.compositeAlpha = alpha;
    info.presentMode = VK_PRESENT_MODE_FIFO_KHR;
    info.clipped = VK_TRUE;
    info.oldSwapchain = old;
    VkResult result = vkCreateSwapchainKHR(device_, &info, nullptr, &swapchain_);
    if (old != VK_NULL_HANDLE) vkDestroySwapchainKHR(device_, old, nullptr);
    if (result != VK_SUCCESS) {
        LOGE("vkCreateSwapchainKHR failed: %d", result);
        swapchain_ = VK_NULL_HANDLE;
        return false;
    }

    uint32_t count = 0;
    VK_TRY(vkGetSwapchainImagesKHR(device_, swapchain_, &count, nullptr));
    images_.resize(count);
    VK_TRY(vkGetSwapchainImagesKHR(device_, swapchain_, &count, images_.data()));

    for (VkImage image : images_) {
        VkImageViewCreateInfo viewInfo{VK_STRUCTURE_TYPE_IMAGE_VIEW_CREATE_INFO};
        viewInfo.image = image;
        viewInfo.viewType = VK_IMAGE_VIEW_TYPE_2D;
        viewInfo.format = swapchainFormat_;
        viewInfo.subresourceRange = {VK_IMAGE_ASPECT_COLOR_BIT, 0, 1, 0, 1};
        VkImageView view;
        VK_TRY(vkCreateImageView(device_, &viewInfo, nullptr, &view));
        imageViews_.push_back(view);

        VkFramebufferCreateInfo framebufferInfo{VK_STRUCTURE_TYPE_FRAMEBUFFER_CREATE_INFO};
        framebufferInfo.renderPass = renderPass_;
        framebufferInfo.attachmentCount = 1;
        framebufferInfo.pAttachments = &view;
        framebufferInfo.width = extent_.width;
        framebufferInfo.height = extent_.height;
        framebufferInfo.layers = 1;
        VkFramebuffer framebuffer;
        VK_TRY(vkCreateFramebuffer(device_, &framebufferInfo, nullptr, &framebuffer));
        framebuffers_.push_back(framebuffer);

        VkSemaphoreCreateInfo semaphoreInfo{VK_STRUCTURE_TYPE_SEMAPHORE_CREATE_INFO};
        VkSemaphore semaphore;
        VK_TRY(vkCreateSemaphore(device_, &semaphoreInfo, nullptr, &semaphore));
        renderFinished_.push_back(semaphore);
    }
    swapchainDirty_ = false;
    return createMasks();
}

// Everything but the swapchain itself, which createSwapchain hands on as oldSwapchain.
void Renderer::destroySwapchain() {
    destroyMasks();
    for (VkFramebuffer framebuffer : framebuffers_) vkDestroyFramebuffer(device_, framebuffer, nullptr);
    for (VkImageView view : imageViews_) vkDestroyImageView(device_, view, nullptr);
    for (VkSemaphore semaphore : renderFinished_) vkDestroySemaphore(device_, semaphore, nullptr);
    framebuffers_.clear();
    imageViews_.clear();
    renderFinished_.clear();
    images_.clear();
}

// Each frame's mask, the swapchain's size, so the tile pass reads it texel for pixel.
bool Renderer::createMasks() {
    for (Frame &frame : frames_) {
        VkImageCreateInfo imageInfo{VK_STRUCTURE_TYPE_IMAGE_CREATE_INFO};
        imageInfo.imageType = VK_IMAGE_TYPE_2D;
        imageInfo.format = VK_FORMAT_R8_UNORM;
        imageInfo.extent = {extent_.width, extent_.height, 1};
        imageInfo.mipLevels = 1;
        imageInfo.arrayLayers = 1;
        imageInfo.samples = VK_SAMPLE_COUNT_1_BIT;
        imageInfo.tiling = VK_IMAGE_TILING_OPTIMAL;
        imageInfo.usage = VK_IMAGE_USAGE_COLOR_ATTACHMENT_BIT | VK_IMAGE_USAGE_SAMPLED_BIT;
        imageInfo.initialLayout = VK_IMAGE_LAYOUT_UNDEFINED;
        VK_TRY(vkCreateImage(device_, &imageInfo, nullptr, &frame.mask));
        VkMemoryRequirements needs;
        vkGetImageMemoryRequirements(device_, frame.mask, &needs);
        VkMemoryAllocateInfo alloc{VK_STRUCTURE_TYPE_MEMORY_ALLOCATE_INFO};
        alloc.allocationSize = needs.size;
        if (!findMemoryType(needs.memoryTypeBits, VK_MEMORY_PROPERTY_DEVICE_LOCAL_BIT, &alloc.memoryTypeIndex)) return false;
        VK_TRY(vkAllocateMemory(device_, &alloc, nullptr, &frame.maskMemory));
        VK_TRY(vkBindImageMemory(device_, frame.mask, frame.maskMemory, 0));

        VkImageViewCreateInfo viewInfo{VK_STRUCTURE_TYPE_IMAGE_VIEW_CREATE_INFO};
        viewInfo.image = frame.mask;
        viewInfo.viewType = VK_IMAGE_VIEW_TYPE_2D;
        viewInfo.format = VK_FORMAT_R8_UNORM;
        viewInfo.subresourceRange = {VK_IMAGE_ASPECT_COLOR_BIT, 0, 1, 0, 1};
        VK_TRY(vkCreateImageView(device_, &viewInfo, nullptr, &frame.maskView));

        VkFramebufferCreateInfo framebufferInfo{VK_STRUCTURE_TYPE_FRAMEBUFFER_CREATE_INFO};
        framebufferInfo.renderPass = maskPass_;
        framebufferInfo.attachmentCount = 1;
        framebufferInfo.pAttachments = &frame.maskView;
        framebufferInfo.width = extent_.width;
        framebufferInfo.height = extent_.height;
        framebufferInfo.layers = 1;
        VK_TRY(vkCreateFramebuffer(device_, &framebufferInfo, nullptr, &frame.maskFramebuffer));

        VkDescriptorImageInfo imageDescriptor{maskSampler_, frame.maskView, VK_IMAGE_LAYOUT_SHADER_READ_ONLY_OPTIMAL};
        VkWriteDescriptorSet write{VK_STRUCTURE_TYPE_WRITE_DESCRIPTOR_SET};
        write.dstSet = frame.maskDescriptor;
        write.dstBinding = 0;
        write.descriptorCount = 1;
        write.descriptorType = VK_DESCRIPTOR_TYPE_COMBINED_IMAGE_SAMPLER;
        write.pImageInfo = &imageDescriptor;
        vkUpdateDescriptorSets(device_, 1, &write, 0, nullptr);
    }
    return true;
}

void Renderer::destroyMasks() {
    for (Frame &frame : frames_) {
        if (frame.maskFramebuffer) vkDestroyFramebuffer(device_, frame.maskFramebuffer, nullptr);
        if (frame.maskView) vkDestroyImageView(device_, frame.maskView, nullptr);
        if (frame.mask) vkDestroyImage(device_, frame.mask, nullptr);
        if (frame.maskMemory) vkFreeMemory(device_, frame.maskMemory, nullptr);
        frame.maskFramebuffer = VK_NULL_HANDLE;
        frame.maskView = VK_NULL_HANDLE;
        frame.mask = VK_NULL_HANDLE;
        frame.maskMemory = VK_NULL_HANDLE;
    }
}

namespace {

// What one pipeline differs in: its shaders, how its instances are read, how it blends.
struct PipelineSpec {
    const uint32_t *vert;
    size_t vertSize;
    const uint32_t *frag;
    size_t fragSize;
    VkPrimitiveTopology topology;
    std::vector<VkVertexInputAttributeDescription> attributes;
    uint32_t instanceStride;  // 0: no instances
    VkPipelineColorBlendAttachmentState blend;
    VkPipelineLayout layout;
    VkRenderPass renderPass;
};

VkPipelineColorBlendAttachmentState opaqueBlend() {
    VkPipelineColorBlendAttachmentState blend{};
    blend.colorWriteMask = VK_COLOR_COMPONENT_R_BIT | VK_COLOR_COMPONENT_G_BIT | VK_COLOR_COMPONENT_B_BIT | VK_COLOR_COMPONENT_A_BIT;
    return blend;
}

// Over what's drawn, from premultiplied colour, as the web's ONE, ONE_MINUS_SRC_ALPHA.
VkPipelineColorBlendAttachmentState premultipliedBlend() {
    VkPipelineColorBlendAttachmentState blend = opaqueBlend();
    blend.blendEnable = VK_TRUE;
    blend.srcColorBlendFactor = VK_BLEND_FACTOR_ONE;
    blend.dstColorBlendFactor = VK_BLEND_FACTOR_ONE_MINUS_SRC_ALPHA;
    blend.colorBlendOp = VK_BLEND_OP_ADD;
    blend.srcAlphaBlendFactor = VK_BLEND_FACTOR_ONE;
    blend.dstAlphaBlendFactor = VK_BLEND_FACTOR_ONE_MINUS_SRC_ALPHA;
    blend.alphaBlendOp = VK_BLEND_OP_ADD;
    return blend;
}

// The holes' coverage, unioned: the larger of what's there and what's drawn.
VkPipelineColorBlendAttachmentState maxBlend() {
    VkPipelineColorBlendAttachmentState blend{};
    blend.colorWriteMask = VK_COLOR_COMPONENT_R_BIT;
    blend.blendEnable = VK_TRUE;
    blend.srcColorBlendFactor = VK_BLEND_FACTOR_ONE;
    blend.dstColorBlendFactor = VK_BLEND_FACTOR_ONE;
    blend.colorBlendOp = VK_BLEND_OP_MAX;
    blend.srcAlphaBlendFactor = VK_BLEND_FACTOR_ONE;
    blend.dstAlphaBlendFactor = VK_BLEND_FACTOR_ONE;
    blend.alphaBlendOp = VK_BLEND_OP_MAX;
    return blend;
}

VkResult buildPipeline(VkDevice device, const PipelineSpec &spec, VkPipeline *out) {
    auto module = [device](const uint32_t *code, size_t size, VkShaderModule *shader) {
        VkShaderModuleCreateInfo info{VK_STRUCTURE_TYPE_SHADER_MODULE_CREATE_INFO};
        info.codeSize = size;
        info.pCode = code;
        return vkCreateShaderModule(device, &info, nullptr, shader);
    };
    VkShaderModule vert = VK_NULL_HANDLE;
    VkShaderModule frag = VK_NULL_HANDLE;
    VkResult result = module(spec.vert, spec.vertSize, &vert);
    if (result == VK_SUCCESS) result = module(spec.frag, spec.fragSize, &frag);
    if (result != VK_SUCCESS) {
        if (vert) vkDestroyShaderModule(device, vert, nullptr);
        return result;
    }

    VkPipelineShaderStageCreateInfo stages[2]{};
    stages[0].sType = VK_STRUCTURE_TYPE_PIPELINE_SHADER_STAGE_CREATE_INFO;
    stages[0].stage = VK_SHADER_STAGE_VERTEX_BIT;
    stages[0].module = vert;
    stages[0].pName = "main";
    stages[1].sType = VK_STRUCTURE_TYPE_PIPELINE_SHADER_STAGE_CREATE_INFO;
    stages[1].stage = VK_SHADER_STAGE_FRAGMENT_BIT;
    stages[1].module = frag;
    stages[1].pName = "main";

    VkVertexInputBindingDescription binding{0, spec.instanceStride, VK_VERTEX_INPUT_RATE_INSTANCE};
    VkPipelineVertexInputStateCreateInfo vertexInput{VK_STRUCTURE_TYPE_PIPELINE_VERTEX_INPUT_STATE_CREATE_INFO};
    if (spec.instanceStride > 0) {
        vertexInput.vertexBindingDescriptionCount = 1;
        vertexInput.pVertexBindingDescriptions = &binding;
        vertexInput.vertexAttributeDescriptionCount = static_cast<uint32_t>(spec.attributes.size());
        vertexInput.pVertexAttributeDescriptions = spec.attributes.data();
    }
    VkPipelineInputAssemblyStateCreateInfo assembly{VK_STRUCTURE_TYPE_PIPELINE_INPUT_ASSEMBLY_STATE_CREATE_INFO};
    assembly.topology = spec.topology;
    VkPipelineViewportStateCreateInfo viewport{VK_STRUCTURE_TYPE_PIPELINE_VIEWPORT_STATE_CREATE_INFO};
    viewport.viewportCount = 1;
    viewport.scissorCount = 1;
    VkPipelineRasterizationStateCreateInfo raster{VK_STRUCTURE_TYPE_PIPELINE_RASTERIZATION_STATE_CREATE_INFO};
    raster.polygonMode = VK_POLYGON_MODE_FILL;
    raster.cullMode = VK_CULL_MODE_NONE;
    raster.lineWidth = 1.0f;
    VkPipelineMultisampleStateCreateInfo multisample{VK_STRUCTURE_TYPE_PIPELINE_MULTISAMPLE_STATE_CREATE_INFO};
    multisample.rasterizationSamples = VK_SAMPLE_COUNT_1_BIT;
    VkPipelineColorBlendStateCreateInfo blend{VK_STRUCTURE_TYPE_PIPELINE_COLOR_BLEND_STATE_CREATE_INFO};
    blend.attachmentCount = 1;
    blend.pAttachments = &spec.blend;
    VkDynamicState dynamicStates[] = {VK_DYNAMIC_STATE_VIEWPORT, VK_DYNAMIC_STATE_SCISSOR};
    VkPipelineDynamicStateCreateInfo dynamic{VK_STRUCTURE_TYPE_PIPELINE_DYNAMIC_STATE_CREATE_INFO};
    dynamic.dynamicStateCount = 2;
    dynamic.pDynamicStates = dynamicStates;

    VkGraphicsPipelineCreateInfo info{VK_STRUCTURE_TYPE_GRAPHICS_PIPELINE_CREATE_INFO};
    info.stageCount = 2;
    info.pStages = stages;
    info.pVertexInputState = &vertexInput;
    info.pInputAssemblyState = &assembly;
    info.pViewportState = &viewport;
    info.pRasterizationState = &raster;
    info.pMultisampleState = &multisample;
    info.pColorBlendState = &blend;
    info.pDynamicState = &dynamic;
    info.layout = spec.layout;
    info.renderPass = spec.renderPass;
    result = vkCreateGraphicsPipelines(device, VK_NULL_HANDLE, 1, &info, nullptr, out);
    vkDestroyShaderModule(device, vert, nullptr);
    vkDestroyShaderModule(device, frag, nullptr);
    return result;
}

} // namespace

bool Renderer::createPipelines() {
    // Tiles: their texture and the frame's mask, and the 80 bytes both stages read.
    VkDescriptorSetLayout tileSets[] = {descriptorLayout_, descriptorLayout_};
    VkPushConstantRange tilePush{VK_SHADER_STAGE_VERTEX_BIT | VK_SHADER_STAGE_FRAGMENT_BIT, 0, sizeof(TilePush)};
    VkPipelineLayoutCreateInfo tileLayoutInfo{VK_STRUCTURE_TYPE_PIPELINE_LAYOUT_CREATE_INFO};
    tileLayoutInfo.setLayoutCount = 2;
    tileLayoutInfo.pSetLayouts = tileSets;
    tileLayoutInfo.pushConstantRangeCount = 1;
    tileLayoutInfo.pPushConstantRanges = &tilePush;
    VK_TRY(vkCreatePipelineLayout(device_, &tileLayoutInfo, nullptr, &tileLayout_));

    // The mask, the pills and the ring: push constants only.
    static_assert(sizeof(ShapePush) == sizeof(SpotPush), "One layout serves both");
    VkPushConstantRange shapePush{VK_SHADER_STAGE_VERTEX_BIT | VK_SHADER_STAGE_FRAGMENT_BIT, 0, sizeof(ShapePush)};
    VkPipelineLayoutCreateInfo shapeLayoutInfo{VK_STRUCTURE_TYPE_PIPELINE_LAYOUT_CREATE_INFO};
    shapeLayoutInfo.pushConstantRangeCount = 1;
    shapeLayoutInfo.pPushConstantRanges = &shapePush;
    VK_TRY(vkCreatePipelineLayout(device_, &shapeLayoutInfo, nullptr, &shapeLayout_));

    constexpr uint32_t f = sizeof(float);
    PipelineSpec tile{tile_vert, sizeof(tile_vert), tile_frag, sizeof(tile_frag), VK_PRIMITIVE_TOPOLOGY_TRIANGLE_STRIP,
                      {}, 0, opaqueBlend(), tileLayout_, renderPass_};
    PipelineSpec mask{mask_vert, sizeof(mask_vert), mask_frag, sizeof(mask_frag), VK_PRIMITIVE_TOPOLOGY_TRIANGLE_STRIP,
                      {{0, 0, VK_FORMAT_R32G32B32A32_SFLOAT, 0}, {1, 0, VK_FORMAT_R32G32B32_SFLOAT, 4 * f}},
                      static_cast<uint32_t>(OverlayLayout::kCutStride * f), maxBlend(), shapeLayout_, maskPass_};
    PipelineSpec pill{pill_vert, sizeof(pill_vert), pill_frag, sizeof(pill_frag), VK_PRIMITIVE_TOPOLOGY_TRIANGLE_STRIP,
                      {{0, 0, VK_FORMAT_R32G32B32A32_SFLOAT, 0},
                       {1, 0, VK_FORMAT_R32G32_SFLOAT, 4 * f},
                       {2, 0, VK_FORMAT_R32G32B32A32_SFLOAT, 6 * f}},
                      static_cast<uint32_t>(OverlayLayout::kPillStride * f), premultipliedBlend(), shapeLayout_, renderPass_};
    PipelineSpec spot{spot_vert, sizeof(spot_vert), spot_frag, sizeof(spot_frag), VK_PRIMITIVE_TOPOLOGY_TRIANGLE_LIST,
                      {}, 0, premultipliedBlend(), shapeLayout_, renderPass_};

    const std::pair<const PipelineSpec *, VkPipeline *> pipelines[] = {
        {&tile, &tilePipeline_}, {&mask, &maskPipeline_}, {&pill, &pillPipeline_}, {&spot, &spotPipeline_}};
    for (const auto &[spec, out] : pipelines) {
        VkResult result = buildPipeline(device_, *spec, out);
        if (result != VK_SUCCESS) {
            LOGE("Building a pipeline failed: %d", result);
            return false;
        }
    }
    return true;
}

// Room for `bytes` of this frame's instances. Safe to replace: its fence has been waited on.
bool Renderer::ensureInstances(Frame &frame, VkDeviceSize bytes) {
    if (bytes <= frame.instanceCapacity) return true;
    const VkDeviceSize capacity = std::max({bytes, kMinInstanceBytes, frame.instanceCapacity * 2});
    if (frame.instances) vkDestroyBuffer(device_, frame.instances, nullptr);
    if (frame.instanceMemory) vkFreeMemory(device_, frame.instanceMemory, nullptr);
    frame.instances = VK_NULL_HANDLE;
    frame.instanceMemory = VK_NULL_HANDLE;
    frame.instanceMapped = nullptr;
    frame.instanceCapacity = 0;

    VkBufferCreateInfo bufferInfo{VK_STRUCTURE_TYPE_BUFFER_CREATE_INFO};
    bufferInfo.size = capacity;
    bufferInfo.usage = VK_BUFFER_USAGE_VERTEX_BUFFER_BIT;
    VK_TRY(vkCreateBuffer(device_, &bufferInfo, nullptr, &frame.instances));
    VkMemoryRequirements needs;
    vkGetBufferMemoryRequirements(device_, frame.instances, &needs);
    VkMemoryAllocateInfo alloc{VK_STRUCTURE_TYPE_MEMORY_ALLOCATE_INFO};
    alloc.allocationSize = needs.size;
    if (!findMemoryType(needs.memoryTypeBits, VK_MEMORY_PROPERTY_HOST_VISIBLE_BIT | VK_MEMORY_PROPERTY_HOST_COHERENT_BIT,
                        &alloc.memoryTypeIndex)) {
        return false;
    }
    VK_TRY(vkAllocateMemory(device_, &alloc, nullptr, &frame.instanceMemory));
    VK_TRY(vkBindBufferMemory(device_, frame.instances, frame.instanceMemory, 0));
    VK_TRY(vkMapMemory(device_, frame.instanceMemory, 0, capacity, 0, &frame.instanceMapped));
    frame.instanceCapacity = capacity;
    return true;
}

bool Renderer::findMemoryType(uint32_t typeBits, VkMemoryPropertyFlags properties, uint32_t *index) const {
    for (uint32_t i = 0; i < memoryProperties_.memoryTypeCount; i++) {
        if ((typeBits & (1u << i)) && (memoryProperties_.memoryTypes[i].propertyFlags & properties) == properties) {
            *index = i;
            return true;
        }
    }
    return false;
}

bool Renderer::upload(int32_t key, const Pixels &pixels) {
    const uint32_t bytesPerPixel = pixels.rgb565 ? 2 : 4;
    const VkFormat format = pixels.rgb565 ? VK_FORMAT_R5G6B5_UNORM_PACK16 : VK_FORMAT_R8G8B8A8_UNORM;
    if (pixels.rgb565 && !rgb565Supported_) return false;
    if (pixels.stride % bytesPerPixel != 0) return false;
    const VkDeviceSize size = static_cast<VkDeviceSize>(pixels.stride) * pixels.height;
    const uint32_t levels = mipLevels(pixels.width, pixels.height);

    // The staging copy of the pixels, row stride and all; the copy below reads past the padding.
    VkBuffer staging = VK_NULL_HANDLE;
    VkDeviceMemory stagingMemory = VK_NULL_HANDLE;
    Texture texture;
    VkCommandBuffer commands = VK_NULL_HANDLE;
    VkFence fence = VK_NULL_HANDLE;
    bool ok = false;

    // A single exit, so every path frees what it made.
    do {
        VkBufferCreateInfo bufferInfo{VK_STRUCTURE_TYPE_BUFFER_CREATE_INFO};
        bufferInfo.size = size;
        bufferInfo.usage = VK_BUFFER_USAGE_TRANSFER_SRC_BIT;
        if (vkCreateBuffer(device_, &bufferInfo, nullptr, &staging) != VK_SUCCESS) break;
        VkMemoryRequirements bufferNeeds;
        vkGetBufferMemoryRequirements(device_, staging, &bufferNeeds);
        VkMemoryAllocateInfo bufferAlloc{VK_STRUCTURE_TYPE_MEMORY_ALLOCATE_INFO};
        bufferAlloc.allocationSize = bufferNeeds.size;
        if (!findMemoryType(bufferNeeds.memoryTypeBits,
                            VK_MEMORY_PROPERTY_HOST_VISIBLE_BIT | VK_MEMORY_PROPERTY_HOST_COHERENT_BIT,
                            &bufferAlloc.memoryTypeIndex)) break;
        if (vkAllocateMemory(device_, &bufferAlloc, nullptr, &stagingMemory) != VK_SUCCESS) break;
        if (vkBindBufferMemory(device_, staging, stagingMemory, 0) != VK_SUCCESS) break;
        void *mapped = nullptr;
        if (vkMapMemory(device_, stagingMemory, 0, size, 0, &mapped) != VK_SUCCESS) break;
        std::memcpy(mapped, pixels.data, size);
        vkUnmapMemory(device_, stagingMemory);

        VkImageCreateInfo imageInfo{VK_STRUCTURE_TYPE_IMAGE_CREATE_INFO};
        imageInfo.imageType = VK_IMAGE_TYPE_2D;
        imageInfo.format = format;
        imageInfo.extent = {pixels.width, pixels.height, 1};
        imageInfo.mipLevels = levels;
        imageInfo.arrayLayers = 1;
        imageInfo.samples = VK_SAMPLE_COUNT_1_BIT;
        imageInfo.tiling = VK_IMAGE_TILING_OPTIMAL;
        imageInfo.usage = VK_IMAGE_USAGE_TRANSFER_SRC_BIT | VK_IMAGE_USAGE_TRANSFER_DST_BIT | VK_IMAGE_USAGE_SAMPLED_BIT;
        imageInfo.initialLayout = VK_IMAGE_LAYOUT_UNDEFINED;
        if (vkCreateImage(device_, &imageInfo, nullptr, &texture.image) != VK_SUCCESS) break;
        VkMemoryRequirements imageNeeds;
        vkGetImageMemoryRequirements(device_, texture.image, &imageNeeds);
        VkMemoryAllocateInfo imageAlloc{VK_STRUCTURE_TYPE_MEMORY_ALLOCATE_INFO};
        imageAlloc.allocationSize = imageNeeds.size;
        if (!findMemoryType(imageNeeds.memoryTypeBits, VK_MEMORY_PROPERTY_DEVICE_LOCAL_BIT, &imageAlloc.memoryTypeIndex)) break;
        if (vkAllocateMemory(device_, &imageAlloc, nullptr, &texture.memory) != VK_SUCCESS) break;
        if (vkBindImageMemory(device_, texture.image, texture.memory, 0) != VK_SUCCESS) break;

        VkCommandBufferAllocateInfo allocInfo{VK_STRUCTURE_TYPE_COMMAND_BUFFER_ALLOCATE_INFO};
        allocInfo.commandPool = commandPool_;
        allocInfo.level = VK_COMMAND_BUFFER_LEVEL_PRIMARY;
        allocInfo.commandBufferCount = 1;
        if (vkAllocateCommandBuffers(device_, &allocInfo, &commands) != VK_SUCCESS) break;
        VkCommandBufferBeginInfo begin{VK_STRUCTURE_TYPE_COMMAND_BUFFER_BEGIN_INFO};
        begin.flags = VK_COMMAND_BUFFER_USAGE_ONE_TIME_SUBMIT_BIT;
        vkBeginCommandBuffer(commands, &begin);

        auto barrier = [&](uint32_t level, uint32_t count, VkImageLayout from, VkImageLayout to, VkAccessFlags srcAccess,
                           VkAccessFlags dstAccess, VkPipelineStageFlags srcStage, VkPipelineStageFlags dstStage) {
            VkImageMemoryBarrier b{VK_STRUCTURE_TYPE_IMAGE_MEMORY_BARRIER};
            b.oldLayout = from;
            b.newLayout = to;
            b.srcQueueFamilyIndex = VK_QUEUE_FAMILY_IGNORED;
            b.dstQueueFamilyIndex = VK_QUEUE_FAMILY_IGNORED;
            b.image = texture.image;
            b.subresourceRange = {VK_IMAGE_ASPECT_COLOR_BIT, level, count, 0, 1};
            b.srcAccessMask = srcAccess;
            b.dstAccessMask = dstAccess;
            vkCmdPipelineBarrier(commands, srcStage, dstStage, 0, 0, nullptr, 0, nullptr, 1, &b);
        };

        barrier(0, levels, VK_IMAGE_LAYOUT_UNDEFINED, VK_IMAGE_LAYOUT_TRANSFER_DST_OPTIMAL, 0,
                VK_ACCESS_TRANSFER_WRITE_BIT, VK_PIPELINE_STAGE_TOP_OF_PIPE_BIT, VK_PIPELINE_STAGE_TRANSFER_BIT);
        VkBufferImageCopy copy{};
        copy.bufferRowLength = pixels.stride / bytesPerPixel;
        copy.imageSubresource = {VK_IMAGE_ASPECT_COLOR_BIT, 0, 0, 1};
        copy.imageExtent = {pixels.width, pixels.height, 1};
        vkCmdCopyBufferToImage(commands, staging, texture.image, VK_IMAGE_LAYOUT_TRANSFER_DST_OPTIMAL, 1, &copy);

        // Each level is the one above it, halved: the web's generateMipmap.
        int32_t w = static_cast<int32_t>(pixels.width);
        int32_t h = static_cast<int32_t>(pixels.height);
        for (uint32_t level = 1; level < levels; level++) {
            barrier(level - 1, 1, VK_IMAGE_LAYOUT_TRANSFER_DST_OPTIMAL, VK_IMAGE_LAYOUT_TRANSFER_SRC_OPTIMAL,
                    VK_ACCESS_TRANSFER_WRITE_BIT, VK_ACCESS_TRANSFER_READ_BIT, VK_PIPELINE_STAGE_TRANSFER_BIT,
                    VK_PIPELINE_STAGE_TRANSFER_BIT);
            const int32_t nextW = std::max(1, w / 2);
            const int32_t nextH = std::max(1, h / 2);
            VkImageBlit blit{};
            blit.srcSubresource = {VK_IMAGE_ASPECT_COLOR_BIT, level - 1, 0, 1};
            blit.srcOffsets[1] = {w, h, 1};
            blit.dstSubresource = {VK_IMAGE_ASPECT_COLOR_BIT, level, 0, 1};
            blit.dstOffsets[1] = {nextW, nextH, 1};
            vkCmdBlitImage(commands, texture.image, VK_IMAGE_LAYOUT_TRANSFER_SRC_OPTIMAL, texture.image,
                           VK_IMAGE_LAYOUT_TRANSFER_DST_OPTIMAL, 1, &blit, VK_FILTER_LINEAR);
            barrier(level - 1, 1, VK_IMAGE_LAYOUT_TRANSFER_SRC_OPTIMAL, VK_IMAGE_LAYOUT_SHADER_READ_ONLY_OPTIMAL,
                    VK_ACCESS_TRANSFER_READ_BIT, VK_ACCESS_SHADER_READ_BIT, VK_PIPELINE_STAGE_TRANSFER_BIT,
                    VK_PIPELINE_STAGE_FRAGMENT_SHADER_BIT);
            w = nextW;
            h = nextH;
        }
        barrier(levels - 1, 1, VK_IMAGE_LAYOUT_TRANSFER_DST_OPTIMAL, VK_IMAGE_LAYOUT_SHADER_READ_ONLY_OPTIMAL,
                VK_ACCESS_TRANSFER_WRITE_BIT, VK_ACCESS_SHADER_READ_BIT, VK_PIPELINE_STAGE_TRANSFER_BIT,
                VK_PIPELINE_STAGE_FRAGMENT_SHADER_BIT);
        vkEndCommandBuffer(commands);

        VkFenceCreateInfo fenceInfo{VK_STRUCTURE_TYPE_FENCE_CREATE_INFO};
        if (vkCreateFence(device_, &fenceInfo, nullptr, &fence) != VK_SUCCESS) break;
        VkSubmitInfo submit{VK_STRUCTURE_TYPE_SUBMIT_INFO};
        submit.commandBufferCount = 1;
        submit.pCommandBuffers = &commands;
        if (vkQueueSubmit(queue_, 1, &submit, fence) != VK_SUCCESS) break;
        if (vkWaitForFences(device_, 1, &fence, VK_TRUE, UINT64_MAX) != VK_SUCCESS) break;

        VkImageViewCreateInfo viewInfo{VK_STRUCTURE_TYPE_IMAGE_VIEW_CREATE_INFO};
        viewInfo.image = texture.image;
        viewInfo.viewType = VK_IMAGE_VIEW_TYPE_2D;
        viewInfo.format = format;
        viewInfo.subresourceRange = {VK_IMAGE_ASPECT_COLOR_BIT, 0, levels, 0, 1};
        if (vkCreateImageView(device_, &viewInfo, nullptr, &texture.view) != VK_SUCCESS) break;

        VkDescriptorSetAllocateInfo setInfo{VK_STRUCTURE_TYPE_DESCRIPTOR_SET_ALLOCATE_INFO};
        setInfo.descriptorPool = descriptorPool_;
        setInfo.descriptorSetCount = 1;
        setInfo.pSetLayouts = &descriptorLayout_;
        if (vkAllocateDescriptorSets(device_, &setInfo, &texture.descriptor) != VK_SUCCESS) break;
        VkDescriptorImageInfo imageDescriptor{sampler_, texture.view, VK_IMAGE_LAYOUT_SHADER_READ_ONLY_OPTIMAL};
        VkWriteDescriptorSet write{VK_STRUCTURE_TYPE_WRITE_DESCRIPTOR_SET};
        write.dstSet = texture.descriptor;
        write.dstBinding = 0;
        write.descriptorCount = 1;
        write.descriptorType = VK_DESCRIPTOR_TYPE_COMBINED_IMAGE_SAMPLER;
        write.pImageInfo = &imageDescriptor;
        vkUpdateDescriptorSets(device_, 1, &write, 0, nullptr);
        ok = true;
    } while (false);

    if (fence) vkDestroyFence(device_, fence, nullptr);
    if (commands) vkFreeCommandBuffers(device_, commandPool_, 1, &commands);
    if (staging) vkDestroyBuffer(device_, staging, nullptr);
    if (stagingMemory) vkFreeMemory(device_, stagingMemory, nullptr);
    if (!ok) {
        LOGE("Couldn't upload texture %d (%ux%u)", key, pixels.width, pixels.height);
        destroyTexture(texture);
        return false;
    }

    release(key);
    textures_[key] = texture;
    return true;
}

void Renderer::release(int32_t key) {
    auto it = textures_.find(key);
    if (it == textures_.end()) return;
    // Frames up to this one may still sample it; it goes once they have all finished.
    garbage_.push_back({it->second, frameNumber_});
    textures_.erase(it);
}

void Renderer::destroyTexture(Texture &texture) {
    if (texture.descriptor) vkFreeDescriptorSets(device_, descriptorPool_, 1, &texture.descriptor);
    if (texture.view) vkDestroyImageView(device_, texture.view, nullptr);
    if (texture.image) vkDestroyImage(device_, texture.image, nullptr);
    if (texture.memory) vkFreeMemory(device_, texture.memory, nullptr);
    texture = Texture{};
}

// A texture released when `frame` frames had been submitted was last sampled by frame - 1, which
// has finished once the frame after it has waited on its slot's fence.
void Renderer::collectGarbage(bool all) {
    auto end = std::remove_if(garbage_.begin(), garbage_.end(), [&](Garbage &g) {
        if (!all && frameNumber_ < g.frame + 1) return false;
        destroyTexture(g.texture);
        return true;
    });
    garbage_.erase(end, garbage_.end());
}

bool Renderer::draw(float tx, float ty, float scale, const Draw *draws, size_t count, const float *overlay,
                    size_t overlayLength) {
    using namespace OverlayLayout;
    if (overlayLength < kHeader) return true;  // Not one Kotlin packed: nothing sensible to draw.
    const size_t cutCount = static_cast<size_t>(overlay[kCutCount]);
    const size_t pillCount = static_cast<size_t>(overlay[kPillCount]);
    if (overlayLength < kHeader + cutCount * kCutStride + pillCount * kPillStride) return true;
    if (surface_ == VK_NULL_HANDLE) return true;  // Detached: nowhere to draw until the next attach.

    if (swapchainDirty_ || swapchain_ == VK_NULL_HANDLE) {
        vkDeviceWaitIdle(device_);
        destroySwapchain();
        if (!createSwapchain()) return false;
    }
    if (framebuffers_.empty()) return true;  // The window has no size yet: nothing to draw into.

    Frame &frame = frames_[frameNumber_ % kFramesInFlight];
    VK_TRY(vkWaitForFences(device_, 1, &frame.inFlight, VK_TRUE, UINT64_MAX));
    collectGarbage(false);

    uint32_t imageIndex = 0;
    VkResult acquired = vkAcquireNextImageKHR(device_, swapchain_, UINT64_MAX, frame.imageAvailable, VK_NULL_HANDLE, &imageIndex);
    if (acquired == VK_ERROR_OUT_OF_DATE_KHR) {
        swapchainDirty_ = true;
        return true;
    }
    if (acquired != VK_SUCCESS && acquired != VK_SUBOPTIMAL_KHR) {
        LOGE("vkAcquireNextImageKHR failed: %d", acquired);
        return false;
    }
    // This frame's instances: the holes, then the pills, straight from the packed overlay.
    const float *cuts = overlay + kHeader;
    const float *pills = cuts + cutCount * kCutStride;
    const VkDeviceSize cutBytes = cutCount * kCutStride * sizeof(float);
    const VkDeviceSize pillBytes = pillCount * kPillStride * sizeof(float);
    if (!ensureInstances(frame, cutBytes + pillBytes)) return false;
    if (cutBytes > 0) std::memcpy(frame.instanceMapped, cuts, cutBytes);
    if (pillBytes > 0) std::memcpy(static_cast<char *>(frame.instanceMapped) + cutBytes, pills, pillBytes);

    VK_TRY(vkResetFences(device_, 1, &frame.inFlight));

    VkCommandBuffer commands = frame.commands;
    VK_TRY(vkResetCommandBuffer(commands, 0));
    VkCommandBufferBeginInfo begin{VK_STRUCTURE_TYPE_COMMAND_BUFFER_BEGIN_INFO};
    begin.flags = VK_COMMAND_BUFFER_USAGE_ONE_TIME_SUBMIT_BIT;
    VK_TRY(vkBeginCommandBuffer(commands, &begin));

    VkViewport viewport{0, 0, static_cast<float>(extent_.width), static_cast<float>(extent_.height), 0, 1};
    VkRect2D scissor{{0, 0}, extent_};

    // World → clip: pixels = world * scale + t, then clip = pixels * 2 / size - 1.
    const float w = static_cast<float>(extent_.width);
    const float h = static_cast<float>(extent_.height);
    const float col0[4] = {scale * 2 / w, 0, 0, 0};
    const float col1[4] = {0, scale * 2 / h, 0, 0};
    const float col2[4] = {tx * 2 / w - 1, ty * 2 / h - 1, 1, 0};
    auto shapePush = [&](float param) {
        ShapePush push{};
        std::memcpy(push.col0, col0, sizeof(col0));
        std::memcpy(push.col1, col1, sizeof(col1));
        std::memcpy(push.col2, col2, sizeof(col2));
        push.params[0] = param;
        return push;
    };

    // The mask: cleared to no holes, then every hole unioned in. Cleared even with none, as the
    // tile pass always reads it.
    VkClearValue noCover{};
    VkRenderPassBeginInfo maskPass{VK_STRUCTURE_TYPE_RENDER_PASS_BEGIN_INFO};
    maskPass.renderPass = maskPass_;
    maskPass.framebuffer = frame.maskFramebuffer;
    maskPass.renderArea.extent = extent_;
    maskPass.clearValueCount = 1;
    maskPass.pClearValues = &noCover;
    vkCmdBeginRenderPass(commands, &maskPass, VK_SUBPASS_CONTENTS_INLINE);
    if (cutCount > 0) {
        vkCmdSetViewport(commands, 0, 1, &viewport);
        vkCmdSetScissor(commands, 0, 1, &scissor);
        vkCmdBindPipeline(commands, VK_PIPELINE_BIND_POINT_GRAPHICS, maskPipeline_);
        ShapePush push = shapePush(overlay[kFeather]);
        vkCmdPushConstants(commands, shapeLayout_, VK_SHADER_STAGE_VERTEX_BIT | VK_SHADER_STAGE_FRAGMENT_BIT, 0,
                           sizeof(push), &push);
        VkDeviceSize offset = 0;
        vkCmdBindVertexBuffers(commands, 0, 1, &frame.instances, &offset);
        vkCmdDraw(commands, 4, static_cast<uint32_t>(cutCount), 0, 0);
    }
    vkCmdEndRenderPass(commands);

    // The page's white, where nothing has arrived yet.
    VkClearValue clear{};
    clear.color = {{1.0f, 1.0f, 1.0f, 1.0f}};
    VkRenderPassBeginInfo pass{VK_STRUCTURE_TYPE_RENDER_PASS_BEGIN_INFO};
    pass.renderPass = renderPass_;
    pass.framebuffer = framebuffers_[imageIndex];
    pass.renderArea.extent = extent_;
    pass.clearValueCount = 1;
    pass.pClearValues = &clear;
    vkCmdBeginRenderPass(commands, &pass, VK_SUBPASS_CONTENTS_INLINE);
    vkCmdSetViewport(commands, 0, 1, &viewport);
    vkCmdSetScissor(commands, 0, 1, &scissor);

    // The tiles, set back by the treatment everywhere the mask doesn't hold it off.
    vkCmdBindPipeline(commands, VK_PIPELINE_BIND_POINT_GRAPHICS, tilePipeline_);
    vkCmdBindDescriptorSets(commands, VK_PIPELINE_BIND_POINT_GRAPHICS, tileLayout_, 1, 1, &frame.maskDescriptor, 0, nullptr);
    TilePush tilePush{};
    std::memcpy(tilePush.col0, col0, sizeof(col0));
    std::memcpy(tilePush.col1, col1, sizeof(col1));
    std::memcpy(tilePush.col2, col2, sizeof(col2));
    tilePush.treatment[0] = overlay[kFade];
    tilePush.treatment[1] = overlay[kDesaturate];
    for (size_t i = 0; i < count; i++) {
        auto texture = textures_.find(draws[i].key);
        if (texture == textures_.end()) continue;
        tilePush.rect[0] = draws[i].x;
        tilePush.rect[1] = draws[i].y;
        tilePush.rect[2] = draws[i].w;
        tilePush.rect[3] = draws[i].h;
        vkCmdBindDescriptorSets(commands, VK_PIPELINE_BIND_POINT_GRAPHICS, tileLayout_, 0, 1,
                                &texture->second.descriptor, 0, nullptr);
        vkCmdPushConstants(commands, tileLayout_, VK_SHADER_STAGE_VERTEX_BIT | VK_SHADER_STAGE_FRAGMENT_BIT, 0,
                           sizeof(tilePush), &tilePush);
        vkCmdDraw(commands, 4, 1, 0, 0);
    }

    // The pills over them, their edges a pixel soft at any zoom.
    if (pillCount > 0) {
        vkCmdBindPipeline(commands, VK_PIPELINE_BIND_POINT_GRAPHICS, pillPipeline_);
        ShapePush push = shapePush(1.0f / scale);
        vkCmdPushConstants(commands, shapeLayout_, VK_SHADER_STAGE_VERTEX_BIT | VK_SHADER_STAGE_FRAGMENT_BIT, 0,
                           sizeof(push), &push);
        VkDeviceSize offset = cutBytes;
        vkCmdBindVertexBuffers(commands, 0, 1, &frame.instances, &offset);
        vkCmdDraw(commands, 4, static_cast<uint32_t>(pillCount), 0, 0);
    }

    // The ring, last: light over everything.
    if (overlay[kRingOn] > 0) {
        const float *ring = overlay + kRing;
        SpotPush push{
            {ring[0], ring[1], ring[2], ring[3]},
            {ring[4], ring[5], ring[9], ring[10]},
            {ring[6], ring[7], ring[8], ring[11]},
            {tx, ty, scale, 0},
        };
        vkCmdBindPipeline(commands, VK_PIPELINE_BIND_POINT_GRAPHICS, spotPipeline_);
        vkCmdPushConstants(commands, shapeLayout_, VK_SHADER_STAGE_VERTEX_BIT | VK_SHADER_STAGE_FRAGMENT_BIT, 0,
                           sizeof(push), &push);
        vkCmdDraw(commands, 3, 1, 0, 0);
    }

    vkCmdEndRenderPass(commands);
    VK_TRY(vkEndCommandBuffer(commands));

    VkPipelineStageFlags waitStage = VK_PIPELINE_STAGE_COLOR_ATTACHMENT_OUTPUT_BIT;
    VkSubmitInfo submit{VK_STRUCTURE_TYPE_SUBMIT_INFO};
    submit.waitSemaphoreCount = 1;
    submit.pWaitSemaphores = &frame.imageAvailable;
    submit.pWaitDstStageMask = &waitStage;
    submit.commandBufferCount = 1;
    submit.pCommandBuffers = &commands;
    submit.signalSemaphoreCount = 1;
    submit.pSignalSemaphores = &renderFinished_[imageIndex];
    VK_TRY(vkQueueSubmit(queue_, 1, &submit, frame.inFlight));
    frameNumber_++;

    VkPresentInfoKHR present{VK_STRUCTURE_TYPE_PRESENT_INFO_KHR};
    present.waitSemaphoreCount = 1;
    present.pWaitSemaphores = &renderFinished_[imageIndex];
    present.swapchainCount = 1;
    present.pSwapchains = &swapchain_;
    present.pImageIndices = &imageIndex;
    VkResult presented = vkQueuePresentKHR(queue_, &present);
    if (presented == VK_ERROR_OUT_OF_DATE_KHR || presented == VK_SUBOPTIMAL_KHR) {
        swapchainDirty_ = true;
    } else if (presented != VK_SUCCESS) {
        LOGE("vkQueuePresentKHR failed: %d", presented);
        return false;
    }
    return true;
}

} // namespace commute::map
