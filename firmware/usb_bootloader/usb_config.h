#ifndef BUFFERING_CAT_BOOTLOADER_USB_CONFIG_H
#define BUFFERING_CAT_BOOTLOADER_USB_CONFIG_H

#define ENDPOINTS 2
#define USB_PORT D
#define USB_PIN_DP 3
#define USB_PIN_DM 2
/* v1.1 R5 is driven by PD0. Driving PD0 high is harmless on v1.0. */
#define USB_PIN_DPU 0

#define RV003USB_OPTIMIZE_FLASH 1

#ifndef __ASSEMBLER__
#include <stdint.h>

#ifdef INSTANCE_DESCRIPTORS
static const uint8_t device_descriptor[] = {
	18, 1, 0x00, 0x02, 0, 0, 0, 8,
	0x09, 0x12, 0x03, 0xb0, 0, 0, 0, 0, 0, 1,
};

static const uint8_t special_hid_desc[] = {
	0x05, 0x01, 0x09, 0xff, 0x75, 0x08, 0xa1, 0x01,
	0x95, 0x07, 0x85, 0xa8, 0x09, 0xff, 0xb1, 0x00,
	0x95, 0x7f, 0x85, 0xaa, 0x09, 0xff, 0xb1, 0x00,
	0x96, 0x7f, 0x04, 0x85, 0xab, 0x09, 0xff, 0xb1, 0x00,
	0xc0,
};

static const uint8_t config_descriptor[] = {
	9, 2, 34, 0, 1, 1, 0, 0x80, 50,
	9, 4, 0, 0, 1, 3, 0, 0xff, 0,
	9, 0x21, 0x10, 0x01, 0, 1, 0x22, sizeof(special_hid_desc), 0,
	7, 5, 0x81, 3, 8, 0, 0xff,
};

static const struct descriptor_list_struct {
	uint32_t lIndexValue;
	const uint8_t *addr;
	uint8_t length;
} descriptor_list[] = {
	{0x00000100, device_descriptor, sizeof(device_descriptor)},
	{0x00000200, config_descriptor, sizeof(config_descriptor)},
	{0x00002200, special_hid_desc, sizeof(special_hid_desc)},
};

#define DESCRIPTOR_LIST_ENTRIES \
	(sizeof(descriptor_list) / sizeof(struct descriptor_list_struct))
#endif
#endif
#endif
