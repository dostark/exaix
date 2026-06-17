package main

import "math"

// DoublePoint returns a point with doubled coordinates.
func DoublePoint(p Point) Point {
	return Point{X: p.X * 2, Y: p.Y * 2}
}

// Pi is a mathematical constant.
const Pi = 3.14159
