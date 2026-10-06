package ai.openclaw.wear

import android.animation.ValueAnimator
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.os.Build
import android.os.PowerManager
import androidx.annotation.RequiresApi
import androidx.compose.foundation.Canvas
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.SideEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.runtime.setValue
import androidx.compose.runtime.snapshotFlow
import androidx.compose.runtime.withFrameNanos
import androidx.compose.ui.Modifier
import androidx.compose.ui.MotionDurationScale
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.FilterQuality
import androidx.compose.ui.graphics.ImageBitmap
import androidx.compose.ui.res.imageResource
import androidx.compose.ui.unit.IntSize
import androidx.compose.ui.graphics.drawscope.DrawScope
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.drawscope.withTransform
import androidx.compose.ui.platform.LocalContext
import androidx.lifecycle.DefaultLifecycleObserver
import androidx.lifecycle.LifecycleOwner
import androidx.lifecycle.compose.LocalLifecycleOwner
import kotlinx.coroutines.flow.collect
import kotlin.coroutines.coroutineContext
import kotlin.math.PI
import kotlin.math.cos
import kotlin.math.exp
import kotlin.math.max
import kotlin.math.sin

internal data class WearAvatarPose(
  val floatOffset: Float,
  val bodyTilt: Float,
  val bodyStretch: Float,
  val antennaDegrees: Float,
  val antennaDroop: Float,
  val leftClawDegrees: Float,
  val rightClawDegrees: Float,
  val eyeOpenness: Float,
  val gaze: Offset,
  val mouthLevel: Float,
  val haloPulse: Float,
)

@Composable
internal fun WearTalkAvatar(
  state: RealtimeVoiceButtonState,
  mouthLevel: Float,
  syntheticSpeech: Boolean,
  accent: Color,
  danger: Color,
  modifier: Modifier = Modifier,
  animatorScaleSource: WearAnimatorScaleSource? = null,
  motionDurationScale: MotionDurationScale? = null,
  frameClock: WearAvatarFrameClock = ComposeWearAvatarFrameClock,
  onAnimationStateChanged: ((WearAvatarAnimationState) -> Unit)? = null,
) {
  val artwork = ImageBitmap.imageResource(R.drawable.cypherclaw_mascot)
  val animationScale = rememberAnimatorDurationScale(animatorScaleSource, motionDurationScale)
  val animationsEnabled = animationScale > 0f
  val latestState by rememberUpdatedState(state)
  val latestMouthLevel by rememberUpdatedState(mouthLevel)
  val latestSyntheticSpeech by rememberUpdatedState(syntheticSpeech)
  var animationSeconds by remember { mutableFloatStateOf(0f) }
  var smoothedMouth by remember { mutableFloatStateOf(0f) }

  LaunchedEffect(animationScale, frameClock) {
    if (!animationsEnabled) {
      animationSeconds = 0f
      smoothedMouth = 0f
      return@LaunchedEffect
    }
    var lastFrameNanos = 0L
    while (true) {
      frameClock.awaitFrame { frameNanos ->
        if (lastFrameNanos != 0L) {
          val deltaSeconds =
            scaledAvatarDeltaSeconds(
              deltaSeconds = (frameNanos - lastFrameNanos) / 1_000_000_000f,
              durationScale = animationScale,
            )
          animationSeconds = (animationSeconds + deltaSeconds) % AVATAR_ANIMATION_CYCLE_SECONDS
          val targetMouth =
            if (latestState == RealtimeVoiceButtonState.SPEAKING) {
              max(
                latestMouthLevel.coerceIn(0f, 1f),
                if (latestSyntheticSpeech) syntheticSpeechMouth(animationSeconds) else 0f,
              )
            } else {
              0f
            }
          smoothedMouth = smoothAvatarMouth(smoothedMouth, targetMouth, deltaSeconds)
        }
        lastFrameNanos = frameNanos
      }
    }
  }

  val motionInputs = avatarMotionInputs(animationsEnabled, animationSeconds, smoothedMouth)
  val pose = avatarPoseAt(state, motionInputs.animationSeconds, motionInputs.mouthLevel)
  val stateColor = if (state == RealtimeVoiceButtonState.ERROR) danger else accent

  SideEffect {
    onAnimationStateChanged?.invoke(
      WearAvatarAnimationState(
        durationScale = animationScale,
        animationSeconds = motionInputs.animationSeconds,
        mouthLevel = motionInputs.mouthLevel,
      ),
    )
  }

  Canvas(modifier = modifier) {
    val unit = size.minDimension
    val center = Offset(size.width / 2f, size.height / 2f)
    drawCircle(
      color = stateColor.copy(alpha = 0.3f + (0.28f * pose.haloPulse)),
      radius = unit * (0.455f + (0.012f * pose.haloPulse)),
      center = center,
      style = Stroke(width = unit * 0.025f),
    )

    val artScale = unit / CANONICAL_ART_BOX
    val artLeft = center.x - ((CANONICAL_ART_SIZE * artScale) / 2f)
    val artTop = center.y - ((CANONICAL_ART_SIZE * artScale) / 2f) + (unit * 0.025f)
    withTransform({ translate(left = artLeft, top = artTop) }) {
      withTransform({ scale(artScale, artScale, pivot = Offset.Zero) }) {
        drawCanonicalAvatar(pose, artwork)
      }
    }
  }
}

@Composable
internal fun rememberAnimatorDurationScale(
  animatorScaleSource: WearAnimatorScaleSource? = null,
  motionDurationScale: MotionDurationScale? = null,
): Float {
  val context = LocalContext.current
  val lifecycleOwner = LocalLifecycleOwner.current
  val effectiveScaleSource =
    animatorScaleSource
      ?: remember(context, lifecycleOwner) {
        AndroidWearAnimatorScaleSource(context.applicationContext, lifecycleOwner)
      }
  val effectiveScale = rememberEffectiveAnimatorScale(effectiveScaleSource)
  var canonicalScale by remember(motionDurationScale) {
    mutableFloatStateOf(motionDurationScale?.scaleFactor?.coerceAtLeast(0f) ?: 1f)
  }

  LaunchedEffect(motionDurationScale) {
    val composeScale = motionDurationScale ?: coroutineContext[MotionDurationScale]
    if (composeScale == null) {
      canonicalScale = 1f
      return@LaunchedEffect
    }
    // Compose lazily starts its Android scale observer from this getter, which
    // may write snapshot state and therefore must run before snapshotFlow.
    canonicalScale = composeScale.scaleFactor.coerceAtLeast(0f)
    snapshotFlow { composeScale.scaleFactor.coerceAtLeast(0f) }
      .collect { scale -> canonicalScale = scale }
  }

  return resolvedAvatarAnimationScale(canonicalScale, effectiveScale)
}

@Composable
private fun rememberEffectiveAnimatorScale(source: WearAnimatorScaleSource): Float {
  var effectiveScale by remember(source) { mutableFloatStateOf(source.currentScale()) }

  DisposableEffect(source) {
    effectiveScale = source.currentScale()
    val subscription = source.subscribe { scale -> effectiveScale = scale.coerceAtLeast(0f) }
    onDispose { subscription.dispose() }
  }

  return effectiveScale
}

internal fun resolvedAvatarAnimationScale(
  canonicalScale: Float,
  effectiveScale: Float,
): Float = if (canonicalScale > 0f && effectiveScale > 0f) canonicalScale else 0f

internal fun interface WearAnimatorScaleSubscription {
  fun dispose()
}

internal interface WearAnimatorScaleSource {
  fun currentScale(): Float

  fun subscribe(onScaleChanged: (Float) -> Unit): WearAnimatorScaleSubscription
}

internal class AndroidWearAnimatorScaleSource(
  private val context: Context,
  private val lifecycleOwner: LifecycleOwner,
) : WearAnimatorScaleSource {
  private val powerManager = context.getSystemService(PowerManager::class.java)

  override fun currentScale(): Float =
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
      ValueAnimator.getDurationScale().coerceAtLeast(0f)
    } else {
      // Compose owns the user duration scale. Legacy Android exposes no listener
      // for Battery Saver's separate override, so keep only that signal here.
      if (powerManager.isPowerSaveMode) 0f else 1f
    }

  override fun subscribe(onScaleChanged: (Float) -> Unit): WearAnimatorScaleSubscription =
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
      subscribeToDurationScale(onScaleChanged)
    } else {
      subscribeToLegacyEffectiveScale(onScaleChanged)
    }

  @RequiresApi(Build.VERSION_CODES.TIRAMISU)
  private fun subscribeToDurationScale(
    onScaleChanged: (Float) -> Unit,
  ): WearAnimatorScaleSubscription {
    val listener =
      ValueAnimator.DurationScaleChangeListener { scale ->
        onScaleChanged(scale.coerceAtLeast(0f))
      }
    ValueAnimator.registerDurationScaleChangeListener(listener)
    onScaleChanged(currentScale())
    return WearAnimatorScaleSubscription {
      ValueAnimator.unregisterDurationScaleChangeListener(listener)
    }
  }

  @Suppress("UnspecifiedRegisterReceiverFlag")
  private fun subscribeToLegacyEffectiveScale(onScaleChanged: (Float) -> Unit): WearAnimatorScaleSubscription {
    val refresh = { onScaleChanged(currentScale()) }
    val receiver =
      object : BroadcastReceiver() {
        override fun onReceive(
          context: Context?,
          intent: Intent?,
        ) {
          refresh()
        }
      }
    val lifecycleObserver =
      object : DefaultLifecycleObserver {
        override fun onStart(owner: LifecycleOwner) {
          refresh()
        }

        override fun onResume(owner: LifecycleOwner) {
          refresh()
        }
      }

    context.registerReceiver(receiver, IntentFilter(PowerManager.ACTION_POWER_SAVE_MODE_CHANGED))
    lifecycleOwner.lifecycle.addObserver(lifecycleObserver)
    refresh()

    return WearAnimatorScaleSubscription {
      context.unregisterReceiver(receiver)
      lifecycleOwner.lifecycle.removeObserver(lifecycleObserver)
    }
  }
}

internal fun interface WearAvatarFrameClock {
  suspend fun awaitFrame(onFrame: (Long) -> Unit)
}

private val ComposeWearAvatarFrameClock = WearAvatarFrameClock { onFrame -> withFrameNanos(onFrame) }

internal data class WearAvatarAnimationState(
  val durationScale: Float,
  val animationSeconds: Float,
  val mouthLevel: Float,
)

internal data class WearAvatarMotionInputs(
  val animationSeconds: Float,
  val mouthLevel: Float,
)

internal fun avatarMotionInputs(
  animationsEnabled: Boolean,
  animationSeconds: Float,
  mouthLevel: Float,
): WearAvatarMotionInputs =
  if (animationsEnabled) {
    WearAvatarMotionInputs(
      animationSeconds = animationSeconds,
      mouthLevel = mouthLevel.coerceIn(0f, 1f),
    )
  } else {
    WearAvatarMotionInputs(animationSeconds = 0f, mouthLevel = 0f)
  }

private fun DrawScope.drawCanonicalAvatar(
  pose: WearAvatarPose,
  artwork: ImageBitmap,
) {
  // The voice halo carries state; the logo itself is only resized uniformly.
  drawImage(
    image = artwork,
    dstSize = IntSize(120, 120),
    filterQuality = FilterQuality.High,
  )
}

internal fun avatarPoseAt(
  state: RealtimeVoiceButtonState,
  animationSeconds: Float,
  mouthLevel: Float,
): WearAvatarPose {
  val tau = 2f * PI.toFloat()
  val breathing = sin(animationSeconds * tau / 3.8f)
  var floatOffset = -2.6f * (1f - cos(animationSeconds * tau / 4.2f))
  var bodyTilt = 0.8f * sin(animationSeconds * tau / 6.4f)
  var bodyStretch = 1f + (0.012f * breathing)
  var antennaDegrees = -3f * sin(animationSeconds * tau / 2.1f)
  var antennaDroop = 0f
  var leftClawDegrees = 0f
  var rightClawDegrees = 0f
  var gaze = Offset(0.45f * sin(animationSeconds * tau / 7.5f), 0.2f * sin(animationSeconds * tau / 5.8f))
  var eyeOpenness = 1f - (0.96f * avatarBlinkClosure(animationSeconds))
  var haloPulse = 0.5f + (0.5f * sin(animationSeconds * tau / 2.4f))

  when (state) {
    RealtimeVoiceButtonState.IDLE -> {}

    RealtimeVoiceButtonState.CONNECTING -> {
      val orbit = animationSeconds * tau / 1.65f
      gaze = Offset(cos(orbit) * 1.05f, sin(orbit) * 0.82f)
      bodyTilt = 2f * sin(animationSeconds * tau / 2.8f)
      antennaDegrees = -7f * sin(animationSeconds * tau / 1.1f)
      leftClawDegrees = 3f * sin(animationSeconds * tau / 1.4f)
      rightClawDegrees = -leftClawDegrees
      haloPulse = 0.5f + (0.5f * sin(animationSeconds * tau / 0.9f))
    }

    RealtimeVoiceButtonState.LISTENING -> {
      val attentivePulse = 0.5f + (0.5f * sin(animationSeconds * tau / 1.25f))
      gaze = Offset(0.2f * sin(animationSeconds * tau / 3.2f), 0.34f)
      bodyStretch += 0.018f * attentivePulse
      leftClawDegrees = 4f + (2f * attentivePulse)
      rightClawDegrees = -leftClawDegrees
      antennaDegrees = -4f * sin(animationSeconds * tau / 1.45f)
      haloPulse = attentivePulse
    }

    RealtimeVoiceButtonState.THINKING -> {
      val orbit = animationSeconds * tau / 2.15f
      gaze = Offset(cos(orbit) * 1.15f, sin(orbit) * 0.92f)
      bodyTilt = 2.8f * sin(animationSeconds * tau / 4.5f)
      antennaDegrees = -7f * sin(animationSeconds * tau / 1.25f)
      leftClawDegrees = 5f + (2f * sin(animationSeconds * tau / 2.7f))
      rightClawDegrees = -10f - (3f * sin(animationSeconds * tau / 2.2f))
      haloPulse = 0.5f + (0.5f * sin(animationSeconds * tau / 1.4f))
    }

    RealtimeVoiceButtonState.SPEAKING -> {
      val speechBeat = sin(animationSeconds * tau / 0.72f)
      floatOffset -= mouthLevel * 2.2f
      bodyStretch += (mouthLevel * 0.055f) + (speechBeat * 0.008f)
      bodyTilt = 1.5f * sin(animationSeconds * tau / 2.1f)
      antennaDegrees = -5f * sin(animationSeconds * tau / 0.95f)
      leftClawDegrees = 4f + (mouthLevel * 10f) + (speechBeat * 2f)
      rightClawDegrees = -leftClawDegrees
      gaze = Offset(0.18f * sin(animationSeconds * tau / 2.6f), 0.12f)
      haloPulse = (0.25f + (mouthLevel * 0.75f)).coerceIn(0f, 1f)
    }

    RealtimeVoiceButtonState.ERROR -> {
      bodyTilt = 2.2f * sin(animationSeconds * tau / 0.42f)
      antennaDroop = 0.72f
      leftClawDegrees = -5f
      rightClawDegrees = 5f
      gaze = Offset(0f, 0.7f)
      eyeOpenness *= 0.72f
      haloPulse = 0.72f + (0.28f * sin(animationSeconds * tau / 0.8f))
    }
  }

  return WearAvatarPose(
    floatOffset = floatOffset,
    bodyTilt = bodyTilt,
    bodyStretch = bodyStretch.coerceIn(0.94f, 1.08f),
    antennaDegrees = antennaDegrees,
    antennaDroop = antennaDroop,
    leftClawDegrees = leftClawDegrees,
    rightClawDegrees = rightClawDegrees,
    eyeOpenness = eyeOpenness.coerceIn(0.04f, 1f),
    gaze = gaze,
    mouthLevel = mouthLevel.coerceIn(0f, 1f),
    haloPulse = haloPulse.coerceIn(0f, 1f),
  )
}

internal fun smoothAvatarMouth(
  current: Float,
  target: Float,
  deltaSeconds: Float,
): Float {
  val safeCurrent = current.coerceIn(0f, 1f)
  val safeTarget = target.coerceIn(0f, 1f)
  val safeDelta = deltaSeconds.coerceIn(0f, 0.05f)
  if (safeDelta == 0f) return safeCurrent

  val responseSeconds = if (safeTarget > safeCurrent) MOUTH_ATTACK_SECONDS else MOUTH_RELEASE_SECONDS
  val blend = (1.0 - exp((-safeDelta / responseSeconds).toDouble())).toFloat()
  return (safeCurrent + ((safeTarget - safeCurrent) * blend)).coerceIn(0f, 1f)
}

internal fun scaledAvatarDeltaSeconds(
  deltaSeconds: Float,
  durationScale: Float,
): Float {
  if (durationScale <= 0f) return 0f
  return (deltaSeconds / durationScale).coerceIn(0f, 0.05f)
}

private fun syntheticSpeechMouth(animationSeconds: Float): Float {
  val tau = 2f * PI.toFloat()
  val syllable = 0.5f + (0.5f * sin(animationSeconds * tau / 0.19f))
  val phrase = 0.68f + (0.32f * sin(animationSeconds * tau / 0.83f))
  return (0.1f + (0.72f * syllable * phrase)).coerceIn(0.08f, 0.86f)
}

private fun avatarBlinkClosure(animationSeconds: Float): Float {
  val phase = animationSeconds % BLINK_CYCLE_SECONDS
  return when {
    phase in FIRST_BLINK_START..FIRST_BLINK_END -> {
      smoothBell((phase - FIRST_BLINK_START) / (FIRST_BLINK_END - FIRST_BLINK_START))
    }

    phase in SECOND_BLINK_START..SECOND_BLINK_END -> {
      smoothBell((phase - SECOND_BLINK_START) / (SECOND_BLINK_END - SECOND_BLINK_START))
    }

    else -> {
      0f
    }
  }
}

private fun smoothBell(value: Float): Float {
  val mirrored = if (value < 0.5f) value * 2f else (1f - value) * 2f
  val clamped = mirrored.coerceIn(0f, 1f)
  return clamped * clamped * (3f - (2f * clamped))
}

private const val CANONICAL_ART_SIZE = 120f
private const val CANONICAL_ART_BOX = 126f
private const val AVATAR_ANIMATION_CYCLE_SECONDS = 60f
private const val MOUTH_ATTACK_SECONDS = 0.045f
private const val MOUTH_RELEASE_SECONDS = 0.11f
private const val BLINK_CYCLE_SECONDS = 5.4f
private const val FIRST_BLINK_START = 3.58f
private const val FIRST_BLINK_END = 3.76f
private const val SECOND_BLINK_START = 4.02f
private const val SECOND_BLINK_END = 4.17f
