package id.shiorilabs.commute.core.ui.icons

import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.graphics.vector.path
import androidx.compose.ui.unit.dp

/** The Kuomintang's twelve-rayed sun, white, for a card that has something to celebrate. */
val CommuteIcons.KmtSun: ImageVector by lazy {
    ImageVector.Builder(
        name = "KmtSun",
        defaultWidth = 48.dp,
        defaultHeight = 48.dp,
        viewportWidth = 600f,
        viewportHeight = 600f,
    ).apply {
        val white = SolidColor(Color.White)
        path(fill = white) {
            moveTo(400f, 300f)
            arcTo(100f, 100f, 0f, isMoreThanHalf = true, isPositiveArc = true, 200f, 300f)
            arcTo(100f, 100f, 0f, isMoreThanHalf = true, isPositiveArc = true, 400f, 300f)
            close()
        }
        for (ray in RAYS) {
            path(fill = white) {
                moveTo(ray[0], ray[1])
                lineTo(ray[2], ray[3])
                lineTo(ray[4], ray[5])
                close()
            }
        }
    }.build()
}

private val RAYS = listOf(
    floatArrayOf(270.67f, 190.53f, 300.00f, 0.00f, 329.33f, 190.53f),
    floatArrayOf(329.33f, 190.53f, 450.00f, 40.19f, 380.14f, 219.86f),
    floatArrayOf(380.14f, 219.86f, 559.81f, 150.00f, 409.47f, 270.67f),
    floatArrayOf(409.47f, 270.67f, 600.00f, 300.00f, 409.47f, 329.33f),
    floatArrayOf(409.47f, 329.33f, 559.81f, 450.00f, 380.14f, 380.14f),
    floatArrayOf(380.14f, 380.14f, 450.00f, 559.81f, 329.33f, 409.47f),
    floatArrayOf(329.33f, 409.47f, 300.00f, 600.00f, 270.67f, 409.47f),
    floatArrayOf(270.67f, 409.47f, 150.00f, 559.81f, 219.86f, 380.14f),
    floatArrayOf(219.86f, 380.14f, 40.19f, 450.00f, 190.53f, 329.33f),
    floatArrayOf(190.53f, 329.33f, 0.00f, 300.00f, 190.53f, 270.67f),
    floatArrayOf(190.53f, 270.67f, 40.19f, 150.00f, 219.86f, 219.86f),
    floatArrayOf(219.86f, 219.86f, 150.00f, 40.19f, 270.67f, 190.53f),
)
