package id.shiorilabs.commute.core.ui.frost

import android.app.ActivityManager
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.platform.LocalContext

/**
 * RAM below which the frost draws its tint alone. `totalMem` is what the kernel can hand out, well
 * under what is soldered on, so this admits 6GB phones and drops nominal 4GB ones.
 */
private const val MIN_TOTAL_RAM_BYTES = 4L * 1024 * 1024 * 1024

/**
 * Whether the frost behind a pinned header should actually blur. It redraws on every frame of a
 * scroll under the header, and a flat tinted header that scrolls smoothly beats a frosted one that
 * stutters, so a low-RAM phone, and anything with too little memory to have the GPU for it, gets
 * the tint alone.
 */
@Composable
fun rememberFrostBlurEnabled(): Boolean {
    val context = LocalContext.current
    return remember(context) {
        val manager = context.getSystemService(ActivityManager::class.java) ?: return@remember false
        if (manager.isLowRamDevice) {
            return@remember false
        }
        val memory = ActivityManager.MemoryInfo()
        manager.getMemoryInfo(memory)
        memory.totalMem >= MIN_TOTAL_RAM_BYTES
    }
}
