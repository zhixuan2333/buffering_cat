#ifndef BUFFERING_CAT_COMPAT_STRING_H
#define BUFFERING_CAT_COMPAT_STRING_H

#include <stddef.h>

size_t strlen(const char *s);
size_t strnlen(const char *s, size_t n);
void *memset(void *dest, int c, size_t n);
char *strcpy(char *dest, const char *src);
char *strncpy(char *dest, const char *src, size_t n);
int strcmp(const char *left, const char *right);
int strncmp(const char *left, const char *right, size_t n);
char *strstr(const char *haystack, const char *needle);
char *strchr(const char *s, int c);
char *strrchr(const char *s, int c);
void *memcpy(void *dest, const void *src, size_t n);
int memcmp(const void *left, const void *right, size_t n);
void *memmove(void *dest, const void *src, size_t n);
void *memchr(const void *src, int c, size_t n);

#endif
