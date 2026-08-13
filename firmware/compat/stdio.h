#ifndef BUFFERING_CAT_COMPAT_STDIO_H
#define BUFFERING_CAT_COMPAT_STDIO_H

/*
 * ch32fun supplies these functions itself, but includes the standard headers
 * for their declarations. Homebrew's headerless riscv64-elf-gcc does not ship
 * newlib, so provide only the declarations ch32fun needs.
 */
#include <stdarg.h>
#include <stddef.h>

int printf(const char *format, ...);
int vprintf(const char *format, va_list args);
int snprintf(char *buffer, size_t buffer_len, const char *format, ...);
int sprintf(char *buffer, const char *format, ...);
int puts(const char *s);
int putchar(int c);

#endif
