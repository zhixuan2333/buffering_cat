#ifndef BUFFERING_CAT_USB_CONFIG_H
#define BUFFERING_CAT_USB_CONFIG_H

#define ENDPOINTS 2

/* PCB routing: CH32V003 PD3 = D+, PD2 = D-. */
#define USB_PORT D
#define USB_PIN_DP 3
#define USB_PIN_DM 2

/* v1.1 routes PD0 through R5 (1.5 kOhm) to D- as a controlled pull-up. */
#if BUFFERING_CAT_HARDWARE_REV == 11
#define USB_PIN_DPU 0
#endif

#define RV003USB_OPTIMIZE_FLASH 1
#define RV003USB_EVENT_DEBUGGING 0
#define RV003USB_HANDLE_IN_REQUEST 1
#define RV003USB_OTHER_CONTROL 1
#define RV003USB_HANDLE_USER_DATA 1
#define RV003USB_HID_FEATURES 1
#define RV003USB_USE_REBOOT_FEATURE_REPORT 1

#ifndef __ASSEMBLER__

#include <stdint.h>

#ifdef INSTANCE_DESCRIPTORS

static const uint8_t device_descriptor[] = {
	18, 0x01, 0x10, 0x01,
	0x00, 0x00, 0x00, 0x08,
	0x09, 0x12, /* VID 0x1209 (pid.codes shared development VID). */
	0x03, 0xd0, /* PID 0xd003 (rv003usb development PID). */
	0x00, 0x01,
	1, 2, 3, 1,
};

/* Vendor-defined LED report plus the rv003usb bootloader reboot report. */
static const uint8_t hid_report_descriptor[] = {
	0x06, 0x00, 0xff, /* Usage Page (Vendor 0xff00). */
	0x09, 0x01,       /* Usage 1. */
	0xa1, 0x01,       /* Collection (Application). */
	0x85, 0x01,       /* Report ID 1. */
	0x15, 0x00,       /* Logical Minimum 0. */
	0x26, 0xff, 0x00, /* Logical Maximum 255. */
	0x75, 0x08,       /* Report Size 8 bits. */
	0x95, 0x0f,       /* Report Count 15 bytes. */
	0x09, 0x01,       /* Usage 1. */
	0xb1, 0x02,       /* Feature (Data, Variable, Absolute). */
	0x85, 0xfd,       /* Report ID 0xfd: reboot to USB bootloader. */
	0x95, 0x06,       /* Six-byte magic payload. */
	0x09, 0x02,       /* Usage 2. */
	0xb1, 0x02,       /* Feature (Data, Variable, Absolute). */
	0xc0,             /* End Collection. */
};

static const uint8_t config_descriptor[] = {
	9, 0x02, 34, 0,
	1, 1, 0, 0x80, 50,
	9, 0x04, 0, 0, 1, 0x03, 0x00, 0x00, 0,
	9, 0x21, 0x11, 0x01, 0, 1, 0x22,
	sizeof(hid_report_descriptor), 0,
	7, 0x05, 0x81, 0x03, 1, 0, 10,
};

#define STR_MANUFACTURER u"Zhixuan"
#define STR_PRODUCT u"Buffering Cat LED"
#define STR_SERIAL u"BUFFERINGCAT001"

struct usb_string_descriptor {
	uint8_t length;
	uint8_t type;
	uint16_t string[];
};

static const struct usb_string_descriptor string0 = {4, 3, {0x0409}};
static const struct usb_string_descriptor string1 = {
	sizeof(STR_MANUFACTURER), 3, STR_MANUFACTURER};
static const struct usb_string_descriptor string2 = {
	sizeof(STR_PRODUCT), 3, STR_PRODUCT};
static const struct usb_string_descriptor string3 = {
	sizeof(STR_SERIAL), 3, STR_SERIAL};

static const struct descriptor_list_struct {
	uint32_t lIndexValue;
	const uint8_t *addr;
	uint8_t length;
} descriptor_list[] = {
	{0x00000100, device_descriptor, sizeof(device_descriptor)},
	{0x00000200, config_descriptor, sizeof(config_descriptor)},
	{0x00002200, hid_report_descriptor, sizeof(hid_report_descriptor)},
	{0x00002100, config_descriptor + 18, 9},
	{0x00000300, (const uint8_t *)&string0, 4},
	{0x04090301, (const uint8_t *)&string1, sizeof(STR_MANUFACTURER)},
	{0x04090302, (const uint8_t *)&string2, sizeof(STR_PRODUCT)},
	{0x04090303, (const uint8_t *)&string3, sizeof(STR_SERIAL)},
};

#define DESCRIPTOR_LIST_ENTRIES \
	(sizeof(descriptor_list) / sizeof(struct descriptor_list_struct))

#endif
#endif
#endif
