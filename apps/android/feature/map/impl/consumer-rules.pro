# The renderer's C++ finds MapNative's methods by their JNI names, which R8 must not rename.
-keepclasseswithmembernames class * {
    native <methods>;
}
