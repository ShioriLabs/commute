package id.shiorilabs.commute.core.ext

import kotlin.reflect.KClass

/** [KClass.java], from the next island over. */
inline val <T : Any> KClass<T>.sunda: Class<T> get() = java
