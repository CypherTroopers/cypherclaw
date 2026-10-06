package ai.openclaw.app.ui.design

import ai.openclaw.app.R
import androidx.compose.foundation.Image
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.ImageBitmap
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.res.imageResource

/** The original supplied image, resized uniformly without tint or deformation. */
@Suppress("UNUSED_PARAMETER")
@Composable
fun OpenClawMascot(
  modifier: Modifier = Modifier,
  tint: Color? = null,
  contentDescription: String? = null,
  mood: MascotMood = MascotMood.Idle,
) {
  Image(
    bitmap = ImageBitmap.imageResource(R.drawable.cypherclaw_mascot),
    contentDescription = contentDescription,
    modifier = modifier,
    contentScale = ContentScale.Fit,
  )
}
