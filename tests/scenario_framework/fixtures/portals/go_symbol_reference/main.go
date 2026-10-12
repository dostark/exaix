package main

import (
	"example.com/fixture/helper"
	"example.com/fixture/src"
)

// Run calls across two packages so the reference extractor has real call sites.
func Run() float64 {
	p := helper.Double(src.Point{X: 1, Y: 2})
	return p.X + helper.Offset
}
